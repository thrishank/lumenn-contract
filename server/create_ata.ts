import {
  bn,
  CompressedAccountWithMerkleContext,
  ValidityProofWithContext,
} from "@lightprotocol/stateless.js";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { payer, program, rpc } from "./app";
import {
  ADDRESS_QUEUE,
  ADDRESS_TREE,
  CLOSE_ACCOUNTS,
} from "../tests/utils/address";
import { Escrow, parseEscrowFromBuffer } from "../tests/utils/fn";
import { get_swap_instruction } from "./jup";
import BN from "bn.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

const sol_mint = new PublicKey("So11111111111111111111111111111111111111112");

export async function create_ata(
  compressed_account: CompressedAccountWithMerkleContext,
  escrow_data: Escrow
) {
  let hash = compressed_account.hash;

  let proof = await rpc.getValidityProofV0(
    [{ hash, tree: ADDRESS_TREE, queue: ADDRESS_QUEUE }],
    []
  );

  const validityProof = proof.compressedProof;

  if (escrow_data.tokens.inputMint === sol_mint) {
    throw new Error("call create wSOL instruction");
  }

  const ata = await getAssociatedTokenAddress(
    escrow_data.tokens.outputMint,
    escrow_data.maker
  );

  const ata_exist = await rpc.getAccountInfo(ata);
  if (ata_exist) {
    throw new Error("ATA already exists");
  }

  const { inAmount, outAmount, instruction_data, accounts, alt } =
    await get_swap_instruction(
      escrow_data.tokens.inputMint.toString(),
      sol_mint.toString(),
      2039280,
      "ExactOut"
    );

  const { inAmount: taking_amount } = await get_swap_instruction(
    escrow_data.tokens.outputMint.toString(),
    sol_mint.toString(),
    2039280,
    "ExactOut"
  );

  const payer_ata = await getAssociatedTokenAddress(sol_mint, payer.publicKey);

  const protocol_vault = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_vault")],
    program.programId
  );

  const protocol_ata = await getAssociatedTokenAddress(
    sol_mint,
    protocol_vault[0]
  );

  const instruction = await program.methods
    .createAta({
      swapData: Buffer.from(instruction_data, "base64"),
      takingAmount: new BN(taking_amount),
      escrowAccount: {
        uniqueId: escrow_data.uniqueId,
        amount: {
          makingAmount: escrow_data.amount.makingAmount,
          takingAmount: escrow_data.amount.takingAmount,
          oriMakingAmount: escrow_data.amount.oriMakingAmount,
          oriTakingAmount: escrow_data.amount.oriTakingAmount,
        },
        expiredAt: escrow_data.expiredAt,
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
      payerWsolAta: payer_ata,
      maker: escrow_data.maker,
      protocolWsolAta: protocol_ata,
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

  // TODO: When mainnet create the alt
  const altAddresses = ["7J9hvm2E2HpJPPghTbBB2PbCSH35bZFryBEd8X2Cgys5", ...alt];

  const altLookups = await Promise.all(
    altAddresses.map(async (address: any) => {
      const alt = await rpc.getAddressLookupTable(new PublicKey(address));
      if (!alt.value) throw new Error(`ALT not found: ${address}`);
      return new AddressLookupTableAccount({
        key: new PublicKey(address),
        state: alt.value.state,
      });
    })
  );

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

  const signature = await rpc.sendTransaction(tx);
  return signature;
}

export async function create_ata_wsol(
  compressed_account: CompressedAccountWithMerkleContext,
  escrow_data: Escrow
) {
  let hash = compressed_account.hash;

  let proof = await rpc.getValidityProofV0(
    [{ hash, tree: ADDRESS_TREE, queue: ADDRESS_QUEUE }],
    []
  );

  const validityProof = proof.compressedProof;

  if (escrow_data.tokens.inputMint != sol_mint) {
    throw new Error("call create ata instruction");
  }

  const ata = await getAssociatedTokenAddress(
    escrow_data.tokens.outputMint,
    escrow_data.maker
  );

  const ata_exist = await rpc.getAccountInfo(ata);
  if (ata_exist) {
    throw new Error("ATA already exists");
  }

  const { instruction_data } = await get_swap_instruction(
    escrow_data.tokens.outputMint.toString(),
    sol_mint.toString(),
    2039280,
    "ExactOut"
  );

  const instruction = await program.methods
    .createAtaWsol({
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
      accountMeta: {
        address: compressed_account.address,
        treeInfo: {
          rootIndex: proof.rootIndices[0],
          merkleTreePubkeyIndex: 0,
          queuePubkeyIndex: 1,
          proveByIndex: false,
          leafIndex: compressed_account.leafIndex,
        },
        outputStateTreeIndex: 0,
      },
    })
    .accounts({
      payer: payer.publicKey,
      maker: escrow_data.maker,
      outputMint: escrow_data.tokens.outputMint,
      inputTokenProgram: escrow_data.tokens.inputTokenProgram,
      outputTokenProgram: escrow_data.tokens.outputTokenProgram,
    })
    .remainingAccounts(CLOSE_ACCOUNTS)
    .instruction();

  const altAddresses = ["7J9hvm2E2HpJPPghTbBB2PbCSH35bZFryBEd8X2Cgys5"];

  const altLookups = await Promise.all(
    altAddresses.map(async (address: any) => {
      const alt = await rpc.getAddressLookupTable(new PublicKey(address));
      if (!alt.value) throw new Error(`ALT not found: ${address}`);
      return new AddressLookupTableAccount({
        key: new PublicKey(address),
        state: alt.value.state,
      });
    })
  );

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

  const signature = await rpc.sendTransaction(tx);
  return signature;
}
