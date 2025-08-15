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
  PublicKey,
  Signer,
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

import { assert } from "chai";
import { assertEscrowDoesNotExist, assertEscrowState } from "../utils/check";
import {
  calculateTransactionSize,
  clone_alt,
  parseEscrowFromBuffer,
} from "../utils/fn";
import { get_swap, get_swap_instruction } from "../utils/jup";

describe("elara/fill_order", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.elara as Program<Elara>;
  const payer: Signer = program.provider.wallet.payer;

  const input_mint = new PublicKey(
    "9RzWC4ZS6LdNUP2LwaY7Ztq5sTxgt3dFLp2jjokhm9Vz"
  );

  const sol_mint = new PublicKey("So11111111111111111111111111111111111111112");

  const output_mint = new PublicKey(
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
  );

  const url =
    "https://devnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d";

  const indexer = "http://34.69.251.52:8784";

  const rpc = createRpc(url, indexer, url);

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

  it("fill order", async () => {
    console.log("Initializing order...");

    const proof = await rpc.getValidityProofV0(undefined, [
      {
        address: bn(address.toBytes()),
        tree: ADDRESS_TREE,
        queue: ADDRESS_QUEUE,
      },
    ]);

    const validityProof = proof.compressedProof;

    const makingAmount = new BN(1_000_000);
    const takingAmount = new BN(500_000);
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

    console.log("Order initialized signature:", tx);
    console.log("Filling order ...");

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

    const { swap, inAmount } = await get_swap(
      "372sKPyyiwU5zYASHzqvYY48Sv4ihEujfN5rGFKhVQ9j",
      "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      makingAmount.toNumber(),
      "ExactIn"
    );

    const { accounts: jup_accounts, alt } = await get_swap_instruction();

    const makerATA = await getAssociatedTokenAddress(
      output_mint,
      payer.publicKey
    );
    const vaultATA = await getAssociatedTokenAddress(
      output_mint,
      protocol_vault[0],
      true
    );

    // Get balances before tx
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
      .fillOrder({
        swapData: Buffer.from(swap.swapInstruction.data, "base64"),
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
        maker: payer.publicKey,
        inputMint: input_mint,
        outputMint: output_mint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        jupiterProgram: new PublicKey(
          "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
        ),
      })
      .remainingAccounts([...CLOSE_ACCOUNTS, ...jup_accounts])
      .instruction();

    const altAddresse = await Promise.all(
      alt.map(async (key: string) => {
        const newAlt = await clone_alt(key);
        return newAlt;
      })
    );

    const altAddresses = [
      "7J9hvm2E2HpJPPghTbBB2PbCSH35bZFryBEd8X2Cgys5",
      ...altAddresse,
    ];

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

    const tx_fill = new VersionedTransaction(message);
    tx_fill.sign([payer]);

    const size = calculateTransactionSize(tx_fill);
    console.log("Transaction size:", size);

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const sig = await rpc.sendTransaction(tx_fill);

    console.log("✅ Signature:", sig);

    const makerAccountAfter = await getAccount(
      program.provider.connection,
      makerATA,
      "processed"
    );
    const vaultAccountAfter = await getAccount(
      program.provider.connection,
      vaultATA,
      "processed"
    );

    const makerBalanceAfter = Number(makerAccountAfter.amount);
    const vaultBalanceAfter = Number(vaultAccountAfter.amount ?? 0);

    assert(
      makerBalanceAfter - makerBalanceBefore >= takingAmount.toNumber(),
      "Tokens not correctly credited from maker"
    );

    assert(
      vaultBalanceBefore - vaultBalanceAfter >= takingAmount.toNumber(),
      "Tokens not correctly debited to protocol vault"
    );

    await assertEscrowDoesNotExist({ rpc, address });
  });

  it("fill order WSOL", async () => {
    const unique_id2 = new BN(Date.now());

    const seeds: Uint8Array[] = [
      Buffer.from("escrow"),
      unique_id2.toArrayLike(Buffer, "le", 8),
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

    const wSOL_ata = await getAssociatedTokenAddress(sol_mint, payer.publicKey);

    const makingAmount = new BN(10_000_000);
    const takingAmount = new BN(1_000_000_0);
    const tx = await program.methods
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
        maker: payer.publicKey,
        inputMint: input_mint,
        outputMint: sol_mint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(INIT_REMAINING_ACCOUNTS)
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .rpc();
    console.log("Order initialized  signature:", tx);
    const vaultATA = await getAssociatedTokenAddress(
      sol_mint,
      protocol_vault[0],
      true
    );

    const vaultAccountBefore = await getAccount(
      program.provider.connection,
      vaultATA
    );

    const vaultBalanceBefore = Number(vaultAccountBefore.amount ?? 0);

    console.log("Filling order ...");

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

    const { swap } = await get_swap(
      "372sKPyyiwU5zYASHzqvYY48Sv4ihEujfN5rGFKhVQ9j",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      sol_mint.toString(),
      makingAmount.toNumber(),
      "ExactIn"
    );

    const { accounts: jup_accounts, alt } = await get_swap_instruction();

    const instruction = await program.methods
      .fillOrder({
        swapData: Buffer.from(swap.swapInstruction.data, "base64"),
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
        maker: payer.publicKey,
        inputMint: input_mint,
        outputMint: sol_mint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        jupiterProgram: new PublicKey(
          "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
        ),
      })
      .remainingAccounts([...CLOSE_ACCOUNTS, ...jup_accounts])
      .instruction();

    const altAddresse = await Promise.all(
      alt.map(async (key: string) => {
        const newAlt = await clone_alt(key);
        return newAlt;
      })
    );

    const altAddresses = [
      "7J9hvm2E2HpJPPghTbBB2PbCSH35bZFryBEd8X2Cgys5",
      ...altAddresse,
    ];

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
        createCloseAccountInstruction(
          wSOL_ata,
          payer.publicKey,
          payer.publicKey
        ),
      ],
    }).compileToV0Message(altLookups);

    const tx_fill = new VersionedTransaction(message);
    tx_fill.sign([payer]);

    const size = calculateTransactionSize(tx_fill);
    console.log("Transaction size:", size);

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const sig = await rpc.sendTransaction(tx_fill);

    console.log("✅ Signature:", sig);

    const vaultAccountAfter = await getAccount(
      program.provider.connection,
      vaultATA
    );

    const makerBalanceAfter = await rpc.getBalance(payer.publicKey);
    const vaultBalanceAfter = Number(vaultAccountAfter.amount ?? 0);

    // assert(
    //   makerBalanceAfter - makerBalanceBefore >= takingAmount.toNumber(),
    //   "Tokens not correctly credited from maker"
    // );

    assert(
      vaultBalanceBefore - vaultBalanceAfter >= takingAmount.toNumber(),
      "Tokens not correctly debited to protocol vault"
    );

    await assertEscrowDoesNotExist({ rpc, address });
  });
});
