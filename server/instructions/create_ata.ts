import { CompressedAccountWithMerkleContext } from "@lightprotocol/stateless.js";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { payer, program, rpc, SOL_MINT } from "../app";
import {
  ADDRESS_QUEUE,
  ADDRESS_TREE,
  CLOSE_ACCOUNTS,
} from "../../tests/utils/address";
import { Escrow } from "../../tests/utils/fn";
import { get_swap_instruction } from "../jup";
import BN from "bn.js";
import {
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { get_rent_quote } from "../token-2022";
import { getComputeUnitsUsed, logger } from "../utils";

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

  if (escrow_data.tokens.inputMint.equals(sol_mint)) {
    throw new Error("call create wSOL instruction");
  }

  const ata = await getAssociatedTokenAddress(
    escrow_data.tokens.outputMint,
    escrow_data.maker,
    true,
    escrow_data.tokens.outputTokenProgram
  );

  const ata_exist = await rpc.getAccountInfo(ata);
  if (ata_exist) {
    throw new Error("ATA already exists");
  }

  let instruction_data;
  let accounts;
  let alt;

  try {
    const result = await get_swap_instruction(
      escrow_data.tokens.inputMint.toString(),
      sol_mint.toString(),
      2039280,
      "ExactOut",
      0,
      true
    );

    instruction_data = result.instruction_data;
    accounts = result.accounts;
    alt = result.alt;
  } catch (err) {
    const amounts = await get_rent_quote(escrow_data.tokens.inputMint);

    const result = await get_swap_instruction(
      escrow_data.tokens.inputMint.toString(),
      sol_mint.toString(),
      Number(amounts.inAmount),
      "ExactIn"
    );

    if (
      result.outAmount - amounts.rent > 0 &&
      result.outAmount - amounts.rent < 1000
    ) {
      throw new Error("Tolarance too high");
    }

    instruction_data = result.instruction_data;
    accounts = result.accounts;
    alt = result.alt;
  }

  let taking_amount: any;
  try {
    const { inAmount } = await get_swap_instruction(
      escrow_data.tokens.outputMint.toString(),
      sol_mint.toString(),
      2039280,
      "ExactOut",
      0
    );
    taking_amount = inAmount;
  } catch {
    const { inAmount } = await get_rent_quote(escrow_data.tokens.outputMint);
    taking_amount = inAmount;
  }

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
      maker: escrow_data.maker,
      inputMint: escrow_data.tokens.inputMint,
      outputMint: escrow_data.tokens.outputMint,
      inputTokenProgram: escrow_data.tokens.inputTokenProgram,
      outputTokenProgram: escrow_data.tokens.outputTokenProgram,
    })
    .remainingAccounts([...CLOSE_ACCOUNTS, ...accounts])
    .instruction();

  const altAddresses = ["9NYFyEqPkyXUhkerbGHXUXkvb4qpzeEdHuGpgbgpH1NJ", ...alt];

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

  const tx_sim = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: "DYFUNubBm23g4yaEhqd78HCnCVo4uiexgFiEKRhpw9EX",
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_390_000 }),
        instruction,
      ],
    }).compileToV0Message(altLookups)
  );

  const CU = await getComputeUnitsUsed(tx_sim);

  const latestBlockhash = await rpc.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }),
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

  if (!escrow_data.tokens.inputMint.equals(sol_mint)) {
    throw new Error("call create ata instruction");
  }

  const ata = await getAssociatedTokenAddress(
    escrow_data.tokens.outputMint,
    escrow_data.maker,
    true,
    escrow_data.tokens.outputTokenProgram
  );

  const ata_exist = await rpc.getAccountInfo(ata);
  if (ata_exist) {
    throw new Error("ATA already exists");
  }

  let instruction_data: string;

  try {
    const { instruction_data: data } = await get_swap_instruction(
      escrow_data.tokens.outputMint.toString(),
      sol_mint.toString(),
      2039280,
      "ExactOut",
      0
    );
    instruction_data = data;
  } catch {
    const { inAmount } = await get_rent_quote(escrow_data.tokens.outputMint);
    const { instruction_data: data } = await get_swap_instruction(
      escrow_data.tokens.outputMint.toString(),
      sol_mint.toString(),
      Number(inAmount),
      "ExactIn",
      0
    );
    instruction_data = data;
  }

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

  const altAddresses = ["9NYFyEqPkyXUhkerbGHXUXkvb4qpzeEdHuGpgbgpH1NJ"];

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
      ComputeBudgetProgram.setComputeUnitLimit({ units: 350_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }),
      instruction,
    ],
  }).compileToV0Message(altLookups);

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  const signature = await rpc.sendTransaction(tx);
  return signature;
}

export async function create_token_ata(
  compressed_account: CompressedAccountWithMerkleContext,
  escrow_data: Escrow,
  requestId: any
) {
  const ata = await getAssociatedTokenAddress(
    escrow_data.tokens.outputMint,
    escrow_data.maker,
    true,
    escrow_data.tokens.outputTokenProgram
  );

  const ata_exist = await rpc.getAccountInfo(ata);

  if (ata_exist) {
    return false;
  }

  if (!ata_exist && !escrow_data.tokens.outputMint.equals(SOL_MINT)) {
    logger.info("Creating ATA for maker", {
      requestId,
      ata: ata.toString(),
    });

    if (escrow_data.tokens.inputMint.equals(SOL_MINT)) {
      await create_ata_wsol(compressed_account, escrow_data);
    } else {
      await create_ata(compressed_account, escrow_data);
    }

    await new Promise((res) => setTimeout(res, 3000));

    // Verify ATA was created
    const ataVerification = await rpc.getAccountInfo(ata, "processed");
    if (!ataVerification) {
      throw new Error("Failed to create ATA for maker");
    }

    logger.info("ATA created successfully", { requestId });
  }
  return true;
}
