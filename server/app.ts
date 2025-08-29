import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Elara } from "../target/types/elara";
import IDL from "../target/idl/elara.json";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

import express from "express";
import { bn, createRpc } from "@lightprotocol/stateless.js";
import { ADDRESS_QUEUE, ADDRESS_TREE } from "../tests/utils/address";
import { parseEscrowFromBuffer } from "../tests/utils/fn";
import { get_swap_instruction } from "./jup";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { create_ata, create_ata_wsol } from "./create_ata";
import { fill, fill_wsol } from "./fill";
import { expire, expire_wsol } from "./expire";
import * as dotenv from "dotenv";
dotenv.config();

const connection = new Connection("https://api.devnet.solana.com");

const secret = JSON.parse(process.env.KEY!);
export const payer = Keypair.fromSecretKey(Uint8Array.from(secret));

const provider = new AnchorProvider(connection, new Wallet(payer), {});
export const program = new Program<Elara>(IDL as Elara, provider);

const url =
  "https://devnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d";

export const rpc = createRpc(url, url, url);

export const SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

const app = express();

app.listen(3000, () => console.log("Server running on port 3000"));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/fill", async (req, res) => {
  let { order, fill_type } = req.query;

  if (!order) {
    return res.status(400).json({ error: "Missing address parameter" });
  }

  if (fill_type && fill_type !== "partial" && fill_type !== "full") {
    return res.status(400).json({ error: "Invalid fill_type parameter" });
  }

  let address: PublicKey;
  try {
    address = new PublicKey(order);
  } catch (e) {
    return res.status(400).json({ error: "Invalid order not a publickey" });
  }

  let compressed_account = await rpc.getCompressedAccount(
    bn(address.toBytes())
  );

  const buffer = compressed_account?.data?.data!;
  const escrow_data = parseEscrowFromBuffer(buffer);

  let hash = compressed_account.hash;

  let proof = await rpc.getValidityProofV0(
    [{ hash, tree: ADDRESS_TREE, queue: ADDRESS_QUEUE }],
    []
  );

  const ata = await getAssociatedTokenAddress(
    escrow_data.tokens.outputMint,
    escrow_data.maker
  );

  const ata_exist = await rpc.getAccountInfo(ata);

  if (!ata_exist) {
    if (
      escrow_data.tokens.inputMint.toString() ===
      "So11111111111111111111111111111111111111112"
    ) {
      await create_ata_wsol(address);
      // TODO: add ata creation confirmation
    } else {
      await create_ata(address);
    }
  }

  // TODO: if parital then swap should be ExactOut

  const { inAmount, outAmount, instruction_data, accounts, alt } =
    await get_swap_instruction(
      escrow_data.tokens.inputMint.toString(),
      escrow_data.tokens.outputMint.toString(),
      escrow_data.amount.makingAmount.toNumber(),
      "ExactIn"
    );

  if (escrow_data.amount.takingAmount > outAmount) {
    return res.status(400).json("taking amount less than expected");
  }

  if (escrow_data.amount.makingAmount != inAmount) {
    return res.status(400).json("making amount not equal to input amount");
  }

  let tx: VersionedTransaction;

  if (escrow_data.tokens.outputMint === SOL_MINT) {
    tx = await fill_wsol(
      compressed_account,
      escrow_data,
      proof,
      fill_type === "partial" ? "partial" : "full",
      instruction_data,
      accounts,
      alt
    );
  } else {
    tx = await fill(
      compressed_account,
      escrow_data,
      proof,
      fill_type === "partial" ? "partial" : "full",
      instruction_data,
      accounts,
      alt
    );
  }

  tx.sign([payer]);

  const sig = await rpc.sendTransaction(tx);
  return res.status(200).json({ sig });
});

app.get("/expired", async (req, res) => {
  let { order } = req.query;

  if (!order) {
    return res.status(400).json({ error: "Missing address parameter" });
  }

  let address: PublicKey;
  try {
    address = new PublicKey(order);
  } catch (e) {
    return res.status(400).json({ error: "Invalid order not a publickey" });
  }

  let compressed_account = await rpc.getCompressedAccount(
    bn(address.toBytes())
  );

  let hash = compressed_account.hash;

  let proof = await rpc.getValidityProofV0(
    [{ hash, tree: ADDRESS_TREE, queue: ADDRESS_QUEUE }],
    []
  );

  const buffer = compressed_account?.data?.data!;

  const escrow_data = parseEscrowFromBuffer(buffer);

  if (escrow_data.expiredAt.toNumber() > Date.now()) {
    throw new Error("Escrow not expired yet");
  }

  const ata = await getAssociatedTokenAddress(
    escrow_data.tokens.outputMint,
    escrow_data.maker
  );

  const ata_exist = await rpc.getAccountInfo(ata);

  if (!ata_exist) {
    if (
      escrow_data.tokens.inputMint.toString() ===
      "So11111111111111111111111111111111111111112"
    ) {
      await create_ata_wsol(address);
    } else {
      await create_ata(address);
    }
  }

  let tx: VersionedTransaction;

  if (escrow_data.tokens.inputMint === SOL_MINT) {
    tx = await expire_wsol(compressed_account, escrow_data, proof);
  } else {
    tx = await expire(compressed_account, escrow_data, proof);
  }

  tx.sign([payer]);

  const signature = await rpc.sendTransaction(tx);
  return res.status(200).json({ signature });
});
