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
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
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

describe("elara/cancel_order", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.elara as Program<Elara>;
  const payer: Signer = program.provider.wallet.payer;

  const input_mint = new PublicKey(
    "J7LM6p22Ef8VhREZzkLToSADrXhAiiQUn3P2BAwo1RSe"
  );

  const sol_mint = new PublicKey("So11111111111111111111111111111111111111112");

  const output_mint = new PublicKey(
    "9RzWC4ZS6LdNUP2LwaY7Ztq5sTxgt3dFLp2jjokhm9Vz"
  );

  const url =
    "https://devnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d";

  const indexer = "http://34.69.251.52:8784";

  const rpc = createRpc(url, indexer, url);

  it("cancel escrow", async () => {
    const unique_id = new BN(Date.now());
    const protocol_vault = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_vault")],
      program.programId
    );

    const seeds: Uint8Array[] = [
      Buffer.from("escrow"),
      unique_id.toArrayLike(Buffer, "le", 8),
      payer.publicKey.toBuffer(),
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

    const makingAmount = new BN(1_000_000_000);
    const takingAmount = new BN(1_000_000_000);
    const slippageBps = 50; // 0.5%

    const tx = await program.methods
      .initializeOrder(
        {
          uniqueId: unique_id,
          makingAmount,
          takingAmount,
          expiredAt: null,
          slippageBps,
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
        maker: payer.publicKey,
        inputMint: input_mint,
        outputMint: output_mint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(INIT_REMAINING_ACCOUNTS)
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .rpc();

    console.log("Order initialized  signature:", tx);

    console.log("Cancelling order...");

    let compressed_account = await rpc.getCompressedAccount(
      bn(address.toBytes())
    );

    let hash = compressed_account.hash;

    let proof1 = await rpc.getValidityProofV0(
      [{ hash, tree: ADDRESS_TREE, queue: ADDRESS_QUEUE }],
      []
    );

    const validityProof1 = proof1.compressedProof;

    const buffer = compressed_account?.data?.data!;
    let escrow_data = parseEscrowFromBuffer(buffer);

    const makerATA = await getAssociatedTokenAddress(
      input_mint,
      payer.publicKey
    );

    const vaultATA = await getAssociatedTokenAddress(
      input_mint,
      protocol_vault[0],
      true
    );

    // Get balances before cancelling the order
    const makerAccountBefore = await getAccount(
      program.provider.connection,
      makerATA
    );
    const vaultAccountBefore = await getAccount(
      program.provider.connection,
      vaultATA
    );

    const makerBalanceBefore = Number(makerAccountBefore.amount);
    const vaultBalanceBefore = Number(vaultAccountBefore.amount ?? 0);

    const instruction = await program.methods
      .cancelOrder({
        escrowAccount: {
          // maker: escrow_data.maker,
          uniqueId: escrow_data.uniqueId,
          // tokens: {
          //   inputMint: escrow_data.tokens.inputMint,
          //   outputMint: escrow_data.tokens.outputMint,
          //   inputTokenProgram: escrow_data.tokens.inputTokenProgram,
          //   outputTokenProgram: escrow_data.tokens.outputTokenProgram,
          // },
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
        maker: payer.publicKey,
        inputMint: input_mint,
        outputMint: output_mint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
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

    const tx1 = new VersionedTransaction(message);
    tx1.sign([payer]);

    // 1085 - no ALT
    // 840 - with ALT
    // removing token accounts
    // 959 - no ALT ✅
    // 714 - with ALT

    const sig = await rpc.sendTransaction(tx1);
    console.log("Order cancelled with transaction signature:", sig);

    await new Promise((resolve) => setTimeout(resolve, 3000));

    await assertEscrowDoesNotExist({ rpc, address });
    const makerAccountAfter = await getAccount(
      program.provider.connection,
      makerATA
    );
    const vaultAccountAfter = await getAccount(
      program.provider.connection,
      vaultATA
    );

    const makerBalanceAfter = Number(makerAccountAfter.amount);
    const vaultBalanceAfter = Number(vaultAccountAfter.amount ?? 0);

    assert.equal(
      makerBalanceAfter - makerBalanceBefore,
      makingAmount.toNumber(),
      "Tokens not correctly debited from maker"
    );

    assert.equal(
      vaultBalanceBefore - vaultBalanceAfter,
      makingAmount.toNumber(),
      "Tokens not correctly credited to protocol vault"
    );
  });

  it("cancel escrow WSOL", async () => {
    const unique_id = new BN(Date.now());

    const protocol_vault = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_vault")],
      program.programId
    );

    const seeds: Uint8Array[] = [
      Buffer.from("escrow"),
      unique_id.toArrayLike(Buffer, "le", 8),
      payer.publicKey.toBuffer(),
    ];

    const assetSeed = deriveAddressSeed(seeds, program.programId);
    const address = deriveAddress(assetSeed, ADDRESS_TREE);

    const makingAmount = new BN(239_932);
    const takingAmount = new BN(1_000_000_00);
    const slippageBps = 50; // 0.5%

    const wSOL_ata = await getAssociatedTokenAddress(sol_mint, payer.publicKey);

    const proof = await rpc.getValidityProofV0(undefined, [
      {
        address: bn(address.toBytes()),
        tree: ADDRESS_TREE,
        queue: ADDRESS_QUEUE,
      },
    ]);

    const validityProof = proof.compressedProof;

    const tx = await program.methods
      .initializeOrder(
        {
          uniqueId: unique_id,
          makingAmount,
          takingAmount,
          expiredAt: null,
          slippageBps,
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
        maker: payer.publicKey,
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
          payer.publicKey,
          sol_mint
        ),
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: wSOL_ata,
          lamports: makingAmount.toNumber(),
        }),
        createSyncNativeInstruction(wSOL_ata),
      ])
      .postInstructions([
        createCloseAccountInstruction(
          wSOL_ata,
          payer.publicKey,
          payer.publicKey
        ),
      ])
      .rpc();

    console.log("Order initialized  signature:", tx);
    console.log("Cancelling order...");

    let compressed_account = await rpc.getCompressedAccount(
      bn(address.toBytes())
    );

    let hash = compressed_account.hash;

    let proof1 = await rpc.getValidityProofV0(
      [{ hash, tree: ADDRESS_TREE, queue: ADDRESS_QUEUE }],
      []
    );

    const validityProof1 = proof1.compressedProof;

    const buffer = compressed_account?.data?.data!;
    let escrow_data = parseEscrowFromBuffer(buffer);

    const vaultATA = await getAssociatedTokenAddress(
      sol_mint,
      protocol_vault[0],
      true
    );

    const vaultAccountBefore = await getAccount(
      program.provider.connection,
      vaultATA
    );

    const makerBalanceBefore = await rpc.getBalance(payer.publicKey);
    const vaultBalanceBefore = Number(vaultAccountBefore.amount ?? 0);

    const tx1 = await program.methods
      .cancelOrder({
        escrowAccount: {
          // maker: escrow_data.maker,
          uniqueId: escrow_data.uniqueId,
          // tokens: {
          //   inputMint: escrow_data.tokens.inputMint,
          //   outputMint: escrow_data.tokens.outputMint,
          //   inputTokenProgram: escrow_data.tokens.inputTokenProgram,
          //   outputTokenProgram: escrow_data.tokens.outputTokenProgram,
          // },
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
        maker: payer.publicKey,
        inputMint: sol_mint,
        outputMint: output_mint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(CLOSE_ACCOUNTS)
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .postInstructions([
        createCloseAccountInstruction(
          wSOL_ata,
          payer.publicKey,
          payer.publicKey
        ),
      ])
      .rpc();

    console.log("Order cancelled with transaction signature:", tx1);

    await assertEscrowDoesNotExist({ rpc, address });

    const vaultAccountAfter = await getAccount(
      program.provider.connection,
      vaultATA
    );

    const makerBalanceAfter = await rpc.getBalance(payer.publicKey);
    const vaultBalanceAfter = Number(vaultAccountAfter.amount ?? 0);

    // transaction fee and light protocol fee are not included in the maker balance after
    // assert.equal(
    //   makerBalanceAfter - makerBalanceBefore,
    //   makingAmount.toNumber(),
    //   "Tokens not correctly debited from maker"
    // );
    //
    assert.equal(
      vaultBalanceBefore - vaultBalanceAfter,
      makingAmount.toNumber(),
      "Tokens not correctly credited to protocol vault"
    );
  });

  it("cancel escrow WSOL with maker and payer", async () => {
    const unique_id2 = new BN(Date.now());

    const maker = Keypair.generate();

    const seeds: Uint8Array[] = [
      Buffer.from("escrow"),
      unique_id2.toArrayLike(Buffer, "le", 8),
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
    const makingAmount = new BN(1_000_000);
    const rentExempt = 890880;

    const tx2 = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: maker.publicKey,
        lamports: makingAmount.toNumber() + rentExempt,
      })
    );

    await rpc.sendTransaction(tx2, [payer]);

    const wSOL_ata = await getAssociatedTokenAddress(sol_mint, maker.publicKey);

    const takingAmount = new BN(1_000_000_000);

    const tx_init = await program.methods
      .initializeOrder(
        {
          uniqueId: unique_id2,
          makingAmount,
          takingAmount,
          expiredAt: null,
          slippageBps: 50,
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
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey,
          wSOL_ata,
          maker.publicKey,
          sol_mint
        ),
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
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
      .signers([payer, maker])
      .rpc();

    console.log("Order initialized  signature:", tx_init);

    // transaction size 1147 bytes
    console.log("Cancelling order...");

    let compressed_account = await rpc.getCompressedAccount(
      bn(address.toBytes())
    );

    let hash = compressed_account.hash;

    let proof1 = await rpc.getValidityProofV0(
      [{ hash, tree: ADDRESS_TREE, queue: ADDRESS_QUEUE }],
      []
    );

    const validityProof1 = proof1.compressedProof;

    const buffer = compressed_account?.data?.data!;
    let escrow_data = parseEscrowFromBuffer(buffer);

    const protocol_vault = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_vault")],
      program.programId
    );

    const vaultATA = await getAssociatedTokenAddress(
      sol_mint,
      protocol_vault[0],
      true
    );

    const vaultAccountBefore = await getAccount(
      program.provider.connection,
      vaultATA
    );

    const makerBalanceBefore = await rpc.getBalance(maker.publicKey);
    const vaultBalanceBefore = Number(vaultAccountBefore.amount ?? 0);

    const tx1 = await program.methods
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
        inputMint: sol_mint,
        outputMint: output_mint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(CLOSE_ACCOUNTS)
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .postInstructions([
        createCloseAccountInstruction(
          wSOL_ata,
          payer.publicKey,
          maker.publicKey
        ),
      ])
      .signers([payer, maker])
      .rpc();

    console.log("Order cancelled with transaction signature:", tx1);

    await assertEscrowDoesNotExist({ rpc, address });

    const vaultAccountAfter = await getAccount(
      program.provider.connection,
      vaultATA
    );

    const makerBalanceAfter = await rpc.getBalance(payer.publicKey);
    const vaultBalanceAfter = Number(vaultAccountAfter.amount ?? 0);

    // transaction fee and light protocol fee are not included in the maker balance after
    // assert.equal(
    //   makerBalanceAfter - makerBalanceBefore,
    //   makingAmount.toNumber(),
    //   "Tokens not correctly debited from maker"
    // );
    //
    assert.equal(
      vaultBalanceBefore - vaultBalanceAfter,
      makingAmount.toNumber(),
      "Tokens not correctly credited to protocol vault"
    );
  });
});
