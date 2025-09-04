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
  INIT_REMAINING_ACCOUNTS,
} from "../utils/address";

import { assert } from "chai";
import { assertEscrowState } from "../utils/check";

describe("elara/init_order", () => {
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

  const rpc = createRpc(url, url, url);

  const protocol_vault = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_vault")],
    program.programId
  );

  it("init order", async () => {
    const unique_id = new BN(Date.now());

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

    const makerATA = await getAssociatedTokenAddress(
      input_mint,
      payer.publicKey
    );
    const vaultATA = await getAssociatedTokenAddress(
      input_mint,
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

    const makingAmount = new BN(1_000_000_000);
    const takingAmount = new BN(1_000_000_000);

    const instruction = await program.methods
      .initializeOrder(
        {
          uniqueId: unique_id,
          makingAmount,
          takingAmount,
          expiredAt: new BN(123141242141),
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
      .instruction();

    const latestBlockhash = await rpc.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        instruction,
      ],
    }).compileToV0Message();

    // transaction size 1012 bytes

    const tx = new VersionedTransaction(message);
    tx.sign([payer]);

    const sig = await rpc.sendTransaction(tx);

    console.log("Order initialized signature:", sig);
    await new Promise((resolve) => setTimeout(resolve, 3000));

    await assertEscrowState({
      rpc,
      address,
      uniqueId: unique_id,
      maker: payer.publicKey,
      inputMint: input_mint,
      outputMint: output_mint,
      makingAmount,
      takingAmount,
    });

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
      makerBalanceBefore - makerBalanceAfter,
      makingAmount.toNumber(),
      "Tokens not correctly debited from maker"
    );

    assert.equal(
      vaultBalanceAfter - vaultBalanceBefore,
      makingAmount.toNumber(),
      "Tokens not correctly credited to protocol vault"
    );
  });

  it("init order with SOL", async () => {
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

    const solVaultATA = await getAssociatedTokenAddress(
      sol_mint,
      protocol_vault[0],
      true
    );

    const solVaultAccountBefore = await getAccount(
      program.provider.connection,
      solVaultATA
    );
    const solVaultBalanceBefore = Number(solVaultAccountBefore.amount ?? 0);

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

    const instruction = await program.methods
      .initializeOrder(
        {
          uniqueId: unique_id2,
          makingAmount,
          takingAmount,
          expiredAt: null,
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
      .instruction();

    // transaction size 1147 bytes

    const latestBlockhash = await rpc.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
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
        instruction,
        createCloseAccountInstruction(
          wSOL_ata,
          payer.publicKey,
          maker.publicKey
        ),
      ],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([payer, maker]);

    const sig = await rpc.sendTransaction(tx);
    console.log("Order initialized signature:", sig);

    await new Promise((resolve) => setTimeout(resolve, 3000));

    await assertEscrowState({
      rpc,
      address,
      uniqueId: unique_id2,
      maker: maker.publicKey,
      inputMint: sol_mint,
      outputMint: output_mint,
      makingAmount,
      takingAmount,
    });

    const makerBalanceAfter = await rpc.getBalance(maker.publicKey);

    const solVaultAccountAfter = await getAccount(
      program.provider.connection,
      solVaultATA,
      "processed"
    );
    const solVaultBalanceAfter = Number(solVaultAccountAfter.amount ?? 0);

    assert.equal(
      makerBalanceAfter,
      rentExempt,
      "Tokens not correctly debited from maker"
    );

    assert.equal(
      solVaultBalanceAfter - solVaultBalanceBefore,
      makingAmount.toNumber(),
      "Tokens not correctly credited to protocol vault"
    );
  });
});
