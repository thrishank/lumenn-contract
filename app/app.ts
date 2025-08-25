import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Elara } from "../target/types/elara";
import IDL from "../target/idl/elara.json";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import express from "express";
import { bn, createRpc } from "@lightprotocol/stateless.js";
import {
  ADDRESS_QUEUE,
  ADDRESS_TREE,
  CLOSE_ACCOUNTS,
} from "../tests/utils/address";
import { parseEscrowFromBuffer } from "../tests/utils/fn";
import { get_swap_instruction } from "./jup";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { create_ata, create_ata_wsol } from "./create_ata";

export const payer = new Keypair();
const connection = new Connection("https://api.devnet.solana.com");

const provider = new AnchorProvider(connection, new Wallet(payer), {});
export const program = new Program<Elara>(IDL as Elara, provider);

const url =
  "https://devnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d";

export const rpc = createRpc(url, url, url);

const app = express();

app.listen(3000, () => console.log("Server running on port 3000"));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/fill", async (req, res) => {
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

  const validityProof = proof.compressedProof;
  const buffer = compressed_account?.data?.data!;

  const escrow_data = parseEscrowFromBuffer(buffer);

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

  const instruction = await program.methods
    .fillOrder({
      swapData: Buffer.from(instruction_data, "base64"),
      escrowAccount: {
        uniqueId: escrow_data.uniqueId,
        amount: {
          makingAmount: escrow_data.amount.makingAmount,
          takingAmount: escrow_data.amount.takingAmount,
          oriMakingAmount: escrow_data.amount.oriMakingAmount,
          oriTakingAmount: escrow_data.amount.oriTakingAmount,
        },
        expiredAt: escrow_data.expiredAt,
        slippageBps: escrow_data.slippageBps,
        feeBps: escrow_data.feeBps,
        createdAt: escrow_data.createdAt,
        updatedAt: escrow_data.updatedAt,
      },
      proof: {
        0: {
          a: validityProof.a,
          b: validityProof.b,
          c: validityProof.c,
        },
      },
      treeInfo: {
        rootIndex: proof.rootIndices[0],
        merkleTreePubkeyIndex: 0,
        queuePubkeyIndex: 1,
        proveByIndex: false,
        leafIndex: compressed_account.leafIndex,
      },
      outputStateTreeIndex: 0,
    })
    .accounts({
      payer: payer.publicKey,
      maker: payer.publicKey,
      inputMint: escrow_data.tokens.inputMint,
      outputMint: escrow_data.tokens.outputMint,
      inputTokenProgram: escrow_data.tokens.inputTokenProgram,
      outputTokenProgram: escrow_data.tokens.outputTokenProgram,
      jupiterProgram: new PublicKey(
        "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
      ),
    })
    .remainingAccounts([...CLOSE_ACCOUNTS, ...accounts])
    .instruction();

  const altLookups = await Promise.all(
    alt.map(async (address: any) => {
      const alt = await rpc.getAddressLookupTable(new PublicKey(address));
      if (!alt.value) throw new Error(`ALT not found: ${address}`);
      return new AddressLookupTableAccount({
        key: new PublicKey(address),
        state: alt.value.state,
      });
    })
  );

  // TODO: how to handle the WSOL transfers in fill,partial and expired cancel ?
  // currently closing the account auto unwrappes the WSOL but we can't close the account
  // can't close the protocol vault. so create a middle account and close it

  const latestBlockhash = await rpc.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      instruction,
    ],
  }).compileToV0Message(altLookups);

  const tx = new VersionedTransaction(message);
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

  const validityProof = proof.compressedProof;
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

  const instruction = await program.methods
    .cancelOrder({
      escrowAccount: {
        uniqueId: escrow_data.uniqueId,
        amount: {
          makingAmount: escrow_data.amount.makingAmount,
          takingAmount: escrow_data.amount.takingAmount,
          oriMakingAmount: escrow_data.amount.oriMakingAmount,
          oriTakingAmount: escrow_data.amount.oriTakingAmount,
        },
        expiredAt: escrow_data.expiredAt,
        slippageBps: escrow_data.slippageBps,
        feeBps: escrow_data.feeBps,
        createdAt: escrow_data.createdAt,
        updatedAt: escrow_data.updatedAt,
      },
      proof: {
        0: {
          a: validityProof.a,
          b: validityProof.b,
          c: validityProof.c,
        },
      },
      treeInfo: {
        rootIndex: proof.rootIndices[0],
        merkleTreePubkeyIndex: 0,
        queuePubkeyIndex: 1,
        proveByIndex: false,
        leafIndex: compressed_account.leafIndex,
      },
      outputStateTreeIndex: 0,
    })
    .accounts({
      payer: payer.publicKey,
      maker: payer.publicKey,
      inputMint: escrow_data.tokens.inputMint,
      outputMint: escrow_data.tokens.outputMint,
      inputTokenProgram: escrow_data.tokens.inputTokenProgram,
      outputTokenProgram: escrow_data.tokens.outputTokenProgram,
    })
    .remainingAccounts(CLOSE_ACCOUNTS)
    .instruction();

  const latestBlockhash = await rpc.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      instruction,
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  const signature = await rpc.sendTransaction(tx);
  return res.status(200).json({ signature });
});
