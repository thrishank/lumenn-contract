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

  it("init escrow", async () => {
    console.log("escrow address", address.toString());

    console.log("Initializing order...");

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

    // transaction size 1012 bytes

    console.log("Order initialized  signature:", tx);

    await assertEscrowState({
      rpc,
      address,
      uniqueId: unique_id,
      payer: payer.publicKey,
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

    const vaultATA = await getAssociatedTokenAddress(
      input_mint,
      protocol_vault[0],
      true
    );

    const vaultAccountBefore = await getAccount(
      program.provider.connection,
      vaultATA
    );

    const makerBalanceBefore = await rpc.getBalance(payer.publicKey);
    const vaultBalanceBefore = Number(vaultAccountBefore.amount ?? 0);

    const makingAmount = new BN(203_92800);
    const takingAmount = new BN(1_000_000_000);
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

    await assertEscrowState({
      rpc,
      address,
      uniqueId: unique_id2,
      payer: payer.publicKey,
      inputMint: sol_mint,
      outputMint: output_mint,
      makingAmount,
      takingAmount,
    });

    const vaultAccountAfter = await getAccount(
      program.provider.connection,
      vaultATA
    );

    const makerBalanceAfter = await rpc.getBalance(payer.publicKey);
    const vaultBalanceAfter = Number(vaultAccountAfter.amount ?? 0);

    // assert.equal(
    //   makerBalanceBefore - makerBalanceAfter,
    //   makingAmount.toNumber(),
    //   "Tokens not correctly debited from maker"
    // );

    assert.equal(
      vaultBalanceAfter - vaultBalanceBefore,
      makingAmount.toNumber(),
      "Tokens not correctly credited to protocol vault"
    );
  });
});
