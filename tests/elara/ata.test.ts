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
import {
  calculateTransactionSize,
  clone_alt,
  create_alt,
  parseEscrowFromBuffer,
} from "../utils/fn";

import { assert } from "chai";
import { assertEscrowState } from "../utils/check";
import { get_swap, get_swap_instruction } from "../utils/jup";

describe("elara/create_token_account", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.elara as Program<Elara>;
  const payer: Signer = program.provider.wallet.payer;

  const input_mint = new PublicKey(
    "J7LM6p22Ef8VhREZzkLToSADrXhAiiQUn3P2BAwo1RSe"
  );

  const sol_mint = new PublicKey("So11111111111111111111111111111111111111112");

  const output_mint = new PublicKey(
    "Gt1V2qJcAHy8foR4qb7AkpWkEqxghjWkTfoR5P8huvzP"
  );

  const url =
    "https://devnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d";

  const indexer = "http://34.69.251.52:8784";

  const rpc = createRpc(url, indexer, url);

  it("create token account", async () => {
    const { accounts: jup_accounts, alt } = await get_swap_instruction();

    const altAddresse = await Promise.all(
      alt.map(async (key: string) => {
        const newAlt = await clone_alt(key);
        return newAlt;
      })
    );

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

    console.log("closing account for testing...");
    const ata = new PublicKey("Axsmc8d5F8iVikajgit9yvdi3AHTWkCVwF3u65qbWTS"); // out_put mint
    const ixs = createCloseAccountInstruction(
      ata,
      payer.publicKey,
      payer.publicKey,
      [],
      TOKEN_PROGRAM_ID
    );

    const transaction = new Transaction().add(ixs);
    const signature = await rpc.sendTransaction(transaction, [payer]);
    console.log("closed account for testing:", signature);

    console.log("create token account");

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
      "HmTYE1huZakHZn9VwSR6p6mBjGFT8hJUCRC4aWuCCSnd",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "So11111111111111111111111111111111111111112"
    );

    const instruction = await program.methods
      .createAta({
        swapData: Buffer.from(swap.swapInstruction.data, "base64"),
        takingAmount: new BN(100000),
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
        // accountMeta: {
        //   address: compressed_account.address,
        treeInfo: {
          rootIndex: proof1.rootIndices[0],
          merkleTreePubkeyIndex: 0,
          queuePubkeyIndex: 1,
          proveByIndex: false,
          leafIndex: compressed_account.leafIndex,
        },
        outputStateTreeIndex: 0,
        // },
      })
      .accounts({
        payer: payer.publicKey,
        maker: payer.publicKey,
        makerTokenAta: ata,
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

    const tx_ata = new VersionedTransaction(message);
    tx_ata.sign([payer]);

    const size = calculateTransactionSize(tx_ata);
    console.log("Transaction size:", size);

    // after optimizing all
    // 248 - 1048, 1053
    // 249 - 1011
    // 250 - 1012
    // 252 - 1044, 1054
    // 300 - 1170
    // 495 - 1163
    // 1203 with two ALT from JUP

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const sig = await rpc.sendTransaction(tx_ata);

    console.log("✅ Signature:", sig);

    const makerATA = await getAssociatedTokenAddress(
      output_mint,
      payer.publicKey
    );

    let makerAccountExists = false;

    try {
      await getAccount(program.provider.connection, makerATA, "processed");
      makerAccountExists = true;
    } catch (err) {
      makerAccountExists = false;
    }

    assert.isTrue(
      makerAccountExists,
      `Expected token account ${makerATA.toBase58()} to be created, but it does not exist`
    );

    await assertEscrowState({
      rpc,
      address,
      uniqueId: unique_id,
      maker: payer.publicKey,
      inputMint: input_mint,
      outputMint: output_mint,
      makingAmount: new BN(makingAmount).sub(new BN(inAmount)),
      takingAmount: new BN(takingAmount).sub(new BN(100000)),
    });
  });

  /*
  it("create ata account with WSOL", async () => {
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

    const makingAmount = new BN(239_932_00);
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
    console.log("closing account for testing...");
    const ata = new PublicKey("Axsmc8d5F8iVikajgit9yvdi3AHTWkCVwF3u65qbWTS"); // out_put mint

    const ixs = createCloseAccountInstruction(
      ata,
      payer.publicKey,
      payer.publicKey,
      [],
      TOKEN_PROGRAM_ID
    );

    const transaction = new Transaction().add(ixs);
    const signature = await rpc.sendTransaction(transaction, [payer]);
    console.log("closed account for testing:", signature);

    console.log("Creating token account...");

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
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "So11111111111111111111111111111111111111112"
    );

    const instruction = await program.methods
      .createAtaWsol({
        swapData: Buffer.from(swap.swapInstruction.data, "base64"),
        escrowAccount: {
          maker: escrow_data.maker,
          uniqueId: escrow_data.uniqueId,
          tokens: {
            inputMint: escrow_data.tokens.inputMint,
            outputMint: escrow_data.tokens.outputMint,
            inputTokenProgram: escrow_data.tokens.inputTokenProgram,
            outputTokenProgram: escrow_data.tokens.outputTokenProgram,
          },
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
        accountMeta: {
          address: compressed_account.address,
          treeInfo: {
            rootIndex: proof1.rootIndices[0],
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
        maker: payer.publicKey,
        solMint: sol_mint,
        outputMint: output_mint,
        tokenProgram: TOKEN_PROGRAM_ID,
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

    const tx_cancel = new VersionedTransaction(message);
    tx_cancel.sign([payer]);

    const size = calculateTransactionSize(tx_cancel);
    console.log("Transaction size:", size);

    // 976

    const sig = await rpc.sendTransaction(tx_cancel);
    console.log("✅ Signature:", sig);

    const makerATA = await getAssociatedTokenAddress(
      output_mint,
      payer.publicKey
    );

    let makerAccountExists = false;

    try {
      await getAccount(program.provider.connection, makerATA);
      makerAccountExists = true;
    } catch (err) {
      makerAccountExists = false;
    }

    assert.isTrue(
      makerAccountExists,
      `Expected token account ${makerATA.toBase58()} to be created, but it does not exist`
    );

    await assertEscrowState({
      rpc,
      address,
      uniqueId: unique_id,
      maker: payer.publicKey,
      inputMint: sol_mint,
      outputMint: output_mint,
      makingAmount: new BN(makingAmount).sub(new BN(2039280)),
      takingAmount: new BN(takingAmount).sub(new BN(inAmount)),
    });
  });
  */
});
