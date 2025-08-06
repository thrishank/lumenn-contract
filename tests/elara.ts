import * as anchor from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import axios from "axios";
import { Program } from "@coral-xyz/anchor";
import { Elara } from "../target/types/elara";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
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
} from "./utils/address";
import {
  calculateTransactionSize,
  clone_alt,
  create_alt,
  parseEscrowFromBuffer,
} from "./utils/fn";

describe("elara", () => {
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

  const unique_id = new anchor.BN(Date.now());
  const unique_id1 = new anchor.BN(Date.now());
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

  console.clear();

  /*
 it("create token account with input_mint as WSOL", async () => {
    console.log("closing account for testing...");
    const ata = new PublicKey("EyV9cjPNjgp5f3QioFkqDrA8SfjhMau8qNNGzUtKvMYT"); // out_put mint
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

    let proof = await rpc.getValidityProofV0(
      [{ hash, tree: ADDRESS_TREE, queue: ADDRESS_QUEUE }],
      []
    );

    const validityProof = proof.compressedProof;

    const buffer = compressed_account?.data?.data!;
    let escrow_data = parseEscrowFromBuffer(buffer);

    const swap = await get_swap(
      "372sKPyyiwU5zYASHzqvYY48Sv4ihEujfN5rGFKhVQ9j",
      "So11111111111111111111111111111111111111112",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );

    console.log(Buffer.from(swap.swapInstruction.data, "base64").length);

    const tx = await program.methods
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
        maker: payer.publicKey,
        solMint: sol_mint,
        outputMint: output_mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(CLOSE_ACCOUNTS)
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .rpc();
    console.log("signature:", tx);
    console.log("unique id:", unique_id.toString());
  });
  */

  /*
  it("create token account", async () => {
    console.log("closing account for testing...");
    const ata = new PublicKey("EyV9cjPNjgp5f3QioFkqDrA8SfjhMau8qNNGzUtKvMYT"); // out_put mint
    const ixs = createCloseAccountInstruction(
      ata,
      payer.publicKey,
      payer.publicKey,
      [],
      TOKEN_PROGRAM_ID
    );

    const transaction = new Transaction().add(ixs);
    // const signature = await rpc.sendTransaction(transaction, [payer]);
    // console.log("closed account for testing:", signature);

    console.log("Creating token account...");
    let compressed_account = await rpc.getCompressedAccount(
      bn(
        new PublicKey("12PdjJAeKnWPRMtuwnuayLkQAADV2pRP5oxKkmx8vqqn").toBytes()
      )
    );

    let hash = compressed_account.hash;

    let proof = await rpc.getValidityProofV0(
      [{ hash, tree: ADDRESS_TREE, queue: ADDRESS_QUEUE }],
      []
    );

    const validityProof = proof.compressedProof;

    const buffer = compressed_account?.data?.data!;
    let escrow_data = parseEscrowFromBuffer(buffer);

    // a order to swap sol to USDC

    const swap = await get_swap(
      "372sKPyyiwU5zYASHzqvYY48Sv4ihEujfN5rGFKhVQ9j",
      "J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr",
      "So11111111111111111111111111111111111111112"
    );

    // if the making is SOL then create ATA directly no need swap
    // and get the quote for taking_token to sol ExcaOut swap and subtact the in_amout
    //
    // const sol_ata = new PublicKey(
    //   "23qfcQaTtZXrHEeHamQoYnnYYHu8yqynz549AnLNEobJ"
    // );

    const { accounts: jup_accounts, alt } = await get_accounts();

    const instruction = await program.methods
      .createAta({
        swapData: Buffer.from(swap.swapInstruction.data, "base64"),
        takingAmount: new BN(100000),
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
        maker: payer.publicKey,
        makerTokenAta: new PublicKey(
          "EyV9cjPNjgp5f3QioFkqDrA8SfjhMau8qNNGzUtKvMYT"
        ),
        mint: output_mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        jupiterProgram: new PublicKey(
          "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
        ),
      })
      .remainingAccounts([...CLOSE_ACCOUNTS, ...jup_accounts])
      .instruction();

    console.log(alt);

    // TODO: create a alt for the close accounts

    // 7J9hvm2E2HpJPPghTbBB2PbCSH35bZFryBEd8X2Cgys5
    // const alt_close = await create_alt(CLOSE_ACCOUNTS.map((acc) => acc.pubkey));

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
    console.log("altAddresses", altAddresses);

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

    const size = calculateTransactionSize(tx);
    console.log("Transaction size:", size);

    const sig = await rpc.sendTransaction(tx);

    console.log("✅ Signature:", sig);
  });

  /*
  it("Fill order", async () => {
    console.clear();
    console.log("fetching swap...");

    const swap = await get_swap("372sKPyyiwU5zYASHzqvYY48Sv4ihEujfN5rGFKhVQ9j");
    const data = Buffer.from(swap.swapInstruction.data, "base64");
    console.log(Array.from(data));

    console.log("Fill order...");
    const tx = await program.methods
      .fillOrder(data)
      .accounts({
        payer: payer.publicKey,
        maker: payer.publicKey,
        order: Keypair.generate().publicKey,
        inputMint: input_mint,
        outputMint: input_mint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({
        skipPreflight: false,
        commitment: "confirmed",
      });

    // Get transaction details with logs
    const txDetails = await program.provider.connection.getTransaction(tx, {
      commitment: "confirmed",
    });

    console.log("Transaction signature:", tx);
    console.log("Transaction logs:", txDetails?.meta?.logMessages);
  });
  */
});
