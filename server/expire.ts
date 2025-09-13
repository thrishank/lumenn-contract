import { parseEscrowFromBuffer } from "../tests/utils/fn";
import { bn } from "@lightprotocol/stateless.js";
import { payer, program, rpc } from "./app";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ADDRESS_QUEUE,
  ADDRESS_TREE,
  CLOSE_ACCOUNTS,
} from "../tests/utils/address";
import { retryOperation } from "./utils";

export async function expire(address: PublicKey) {
  let compressed_account = await retryOperation(
    () => rpc.getCompressedAccount(bn(address.toBytes())),
    3,
    1000,
    "getCompressedAccount"
  );

  const proof = await rpc.getValidityProofV0(
    [
      {
        hash: compressed_account.hash,
        tree: ADDRESS_TREE,
        queue: ADDRESS_QUEUE,
      },
    ],
    []
  );

  const validityProof = proof.compressedProof;

  const escrow_data = parseEscrowFromBuffer(compressed_account.data.data);

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
      maker: escrow_data.maker,
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
  return tx;
}

export async function expire_wsol(address: PublicKey) {
  const compressed_account = await rpc.getCompressedAccount(
    bn(address.toBytes())
  );

  const proof = await rpc.getValidityProofV0(
    [
      {
        hash: compressed_account.hash,
        tree: ADDRESS_TREE,
        queue: ADDRESS_QUEUE,
      },
    ],
    []
  );

  const validityProof = proof.compressedProof;

  const escrow_data = parseEscrowFromBuffer(compressed_account.data.data);

  const instruction = await program.methods
    .expireWsolOrder({
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
      maker: escrow_data.maker,
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
  return tx;
}
