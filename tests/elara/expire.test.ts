import * as anchor from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { Program } from "@coral-xyz/anchor";
import { Elara } from "../../target/types/elara";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Signer,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { BN } from "bn.js";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import {
  bn,
  createRpc,
  deriveAddress,
  deriveAddressSeed,
} from "@lightprotocol/stateless.js";
import {
  ADDRESS_QUEUE,
  ADDRESS_TREE,
  CLOSE_ACCOUNTS,
  INIT_REMAINING_ACCOUNTS,
} from "../utils/address";
import { parseEscrowFromBuffer } from "../utils/fn";

import { assert } from "chai";
import { assertEscrowDoesNotExist } from "../utils/check";

describe("elara/expire_order", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.elara as Program<Elara>;
  const payer: Signer = program.provider.wallet!.payer!;

  const sol_mint = new PublicKey("So11111111111111111111111111111111111111112");

  const output_mint = new PublicKey(
    "9RzWC4ZS6LdNUP2LwaY7Ztq5sTxgt3dFLp2jjokhm9Vz"
  );

  const url =
    "https://devnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d";

  const indexer = "http://34.69.251.52:8784";

  const rpc = createRpc(url, url, url);

  it("expire order", async () => {
    const unique_id = new BN(Date.now());

    const protocol_vault = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_vault")],
      program.programId
    );

    const makingAmount = new BN(1_000_000_0);
    const maker = Keypair.generate();

    const latestBlockhash =
      await program.provider.connection.getLatestBlockhash();

    const t = new Transaction({
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      blockhash: latestBlockhash.blockhash,
    });
    t.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: maker.publicKey,
        lamports: makingAmount.toNumber(),
      })
    );
    t.sign(payer);

    await rpc.sendTransaction(t, [payer]);

    const seeds: Uint8Array[] = [
      Buffer.from("escrow"),
      unique_id.toArrayLike(Buffer, "le", 8),
      maker.publicKey.toBuffer(),
    ];

    const assetSeed = deriveAddressSeed(seeds, program.programId);
    const address = deriveAddress(assetSeed, ADDRESS_TREE);

    const proof = await rpc.getValidityProofV0(undefined, [
      {
        address: bn(address.toBytes()),
        tree: ADDRESS_TREE,
        queue: ADDRESS_QUEUE,
      },
    ]);

    const validityProof = proof.compressedProof;
    if (!validityProof) {
      return;
    }
    const takingAmount = new BN(1_000_000_000);

    const wSOL_ata = await getAssociatedTokenAddress(sol_mint, maker.publicKey);
    const now = Math.floor(Date.now() / 1000);

    const tx = await program.methods
      .initializeOrder(
        {
          uniqueId: unique_id,
          makingAmount,
          takingAmount,
          expiredAt: new BN(now + 3),
        },
        {
          proof: {
            0: {
              a: validityProof.a,
              b: validityProof.b,
              c: validityProof.c,
            },
          },
          addressTreeInfo: {
            addressMerkleTreePubkeyIndex: 0,
            addressQueuePubkeyIndex: 2,
            rootIndex: proof.rootIndices[0],
          },
          outputStateTreeIndex: 1,
        }
      )
      .accounts({
        payer: payer.publicKey,
        maker: maker.publicKey,
        inputMint: sol_mint,
        outputMint: output_mint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(INIT_REMAINING_ACCOUNTS)
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
        createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey,
          wSOL_ata,
          maker.publicKey,
          sol_mint
        ),
        SystemProgram.transfer({
          fromPubkey: maker.publicKey,
          toPubkey: wSOL_ata,
          lamports: makingAmount.toNumber(),
        }),
        createSyncNativeInstruction(wSOL_ata),
      ])
      .postInstructions([
        createCloseAccountInstruction(
          wSOL_ata,
          payer.publicKey,
          maker.publicKey
        ),
      ])
      .signers([maker, payer])
      .rpc();

    console.log("Order initialized  signature:", tx);
    console.log("Expire order...");

    let compressed_account = await rpc.getCompressedAccount(
      bn(address.toBytes())
    );

    if (!compressed_account) return;

    let hash = compressed_account.hash;

    let proof1 = await rpc.getValidityProofV0(
      [{ hash, tree: ADDRESS_TREE, queue: ADDRESS_QUEUE }],
      []
    );

    const validityProof1 = proof1.compressedProof;

    if (!validityProof1) return;

    const buffer = compressed_account?.data?.data!;
    let escrow_data = parseEscrowFromBuffer(buffer);

    const sol_balance_before = await rpc.getBalance(maker.publicKey);

    const tx1 = await program.methods
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
            a: validityProof1.a,
            b: validityProof1.b,
            c: validityProof1.c,
          },
        },
        treeInfo: {
          rootIndex: proof1.rootIndices[0],
          merkleTreePubkeyIndex: 0,
          queuePubkeyIndex: 1,
          proveByIndex: false,
          leafIndex: compressed_account.leafIndex,
        },
        outputStateTreeIndex: 0,
      })
      .accounts({
        payer: payer.publicKey,
        maker: maker.publicKey,
        outputMint: output_mint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(CLOSE_ACCOUNTS)
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .rpc();

    console.log("Order expired signature:", tx1);

    const sol_balance_after = await rpc.getBalance(
      maker.publicKey,
      "processed"
    );

    assert.equal(
      sol_balance_after - sol_balance_before,
      makingAmount.toNumber()
    );

    assertEscrowDoesNotExist({ rpc, address });
  });
});
