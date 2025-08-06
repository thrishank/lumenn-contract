import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  AddressLookupTableProgram,
  sendAndConfirmTransaction,
  Transaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import { getKeypairFromFile } from "@solana-developers/helpers";

import BN from "bn.js";
import { Buffer } from "buffer";

type Escrow = {
  maker: PublicKey;
  uniqueId: BN;
  tokens: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    inputTokenProgram: PublicKey;
    outputTokenProgram: PublicKey;
  };
  amount: {
    oriMakingAmount: BN;
    oriTakingAmount: BN;
    makingAmount: BN;
    takingAmount: BN;
  };
  slippageBps: number;
  feeBps: BN;
  expiredAt: BN;
  createdAt: BN;
  updatedAt: BN;
};

export function parseEscrowFromBuffer(buffer: Buffer): Escrow {
  if (buffer.byteLength < 226) {
    throw new Error("Buffer is too short to contain a valid Escrow structure.");
  }

  const maker_bytes = buffer.subarray(0, 32);
  const unique_id = buffer.readBigUInt64LE(32);
  const input_mint_bytes = buffer.subarray(40, 72);
  const output_mint = buffer.subarray(72, 104);
  const input_token_program = buffer.subarray(104, 136);
  const output_token_program = buffer.subarray(136, 168);

  const ori_making_amount = buffer.readBigUInt64LE(168);
  const ori_taking_amount = buffer.readBigUInt64LE(176);
  const making_amount = buffer.readBigUInt64LE(184);
  const taking_amount = buffer.readBigUInt64LE(192);

  const slippage_bps = buffer.readBigUInt64LE(200);
  const fee_bps = buffer.readBigUInt64LE(202);
  const expired_at = buffer.readBigInt64LE(210);
  const created_at = buffer.readBigInt64LE(218);
  const updated_at = buffer.readBigInt64LE(226);

  return {
    maker: new PublicKey(maker_bytes),
    uniqueId: new BN(unique_id.toString()),
    tokens: {
      inputMint: new PublicKey(input_mint_bytes),
      outputMint: new PublicKey(output_mint),
      inputTokenProgram: new PublicKey(input_token_program),
      outputTokenProgram: new PublicKey(output_token_program),
    },
    amount: {
      oriMakingAmount: new BN(ori_making_amount.toString()),
      oriTakingAmount: new BN(ori_taking_amount.toString()),
      makingAmount: new BN(making_amount.toString()),
      takingAmount: new BN(taking_amount.toString()),
    },
    slippageBps: Number(slippage_bps),
    feeBps: new BN(fee_bps.toString()),
    expiredAt: new BN(expired_at.toString()),
    createdAt: new BN(created_at.toString()),
    updatedAt: new BN(updated_at.toString()),
  };
}

/**
 * Utility to estimate the size of a versioned transaction
 */
export function calculateTransactionSize(tx: VersionedTransaction): number {
  // Signatures (64 bytes per signature)
  const signatureLength = tx.signatures.length * 64;

  // Message serialization
  const serializedMessage = tx.message.serialize();
  const messageLength = serializedMessage.length;

  // Total = sigs + msg
  return signatureLength + messageLength;
}

const MAINNET = new Connection(
  "https://mainnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d"
);
const DEVNET = new Connection(
  "https://devnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d",
  "confirmed"
);

export async function clone_alt(address: string): Promise<String> {
  const devnetKeypair: Keypair = await getKeypairFromFile();
  const { value: mainnetAlt } = await MAINNET.getAddressLookupTable(
    new PublicKey(address)
  );

  if (!mainnetAlt) {
    throw new Error("ALT not found on mainnet");
  }

  const addresses = mainnetAlt.state.addresses;
  console.log(`Fetched ${addresses.length} addresses from ALT.`);

  const recentSlot = await DEVNET.getSlot();

  // Create new ALT on devnet
  const [createIx, newAltKey] = AddressLookupTableProgram.createLookupTable({
    authority: devnetKeypair.publicKey,
    payer: devnetKeypair.publicKey,
    recentSlot,
  });

  const tx1 = new Transaction().add(createIx);
  await sendAndConfirmTransaction(DEVNET, tx1, [devnetKeypair]);
  console.log("Created new ALT on devnet:", newAltKey.toBase58());

  // Now extend it in chunks of 20 (max allowed)
  const CHUNK_SIZE = 20;
  for (let i = 0; i < addresses.length; i += CHUNK_SIZE) {
    const chunk = addresses.slice(i, i + CHUNK_SIZE);

    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: devnetKeypair.publicKey,
      authority: devnetKeypair.publicKey,
      lookupTable: newAltKey,
      addresses: chunk,
    });

    const tx = new Transaction().add(extendIx);
    await sendAndConfirmTransaction(DEVNET, tx, [devnetKeypair]);

    console.log(`Extended ALT with addresses ${i}–${i + chunk.length - 1}`);
  }

  console.log("✅ ALT cloned to devnet:", newAltKey.toBase58());
  return newAltKey.toString();
}

export async function create_alt(address: PublicKey[]): Promise<String> {
  const devnetKeypair: Keypair = await getKeypairFromFile();

  const recentSlot = await DEVNET.getSlot();

  const [createIx, newAltKey] = AddressLookupTableProgram.createLookupTable({
    authority: devnetKeypair.publicKey,
    payer: devnetKeypair.publicKey,
    recentSlot,
  });

  const tx1 = new Transaction().add(createIx);
  await sendAndConfirmTransaction(DEVNET, tx1, [devnetKeypair]);
  console.log("Created new ALT on devnet:", newAltKey.toBase58());

  // Now extend it in chunks of 20 (max allowed)
  const CHUNK_SIZE = 20;
  for (let i = 0; i < address.length; i += CHUNK_SIZE) {
    const chunk = address.slice(i, i + CHUNK_SIZE);

    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: devnetKeypair.publicKey,
      authority: devnetKeypair.publicKey,
      lookupTable: newAltKey,
      addresses: chunk,
    });

    const tx = new Transaction().add(extendIx);
    await sendAndConfirmTransaction(DEVNET, tx, [devnetKeypair]);

    console.log(`Extended ALT with addresses ${i}–${i + chunk.length - 1}`);
  }

  console.log("✅ ALT cloned to devnet:", newAltKey.toBase58());
  return newAltKey.toString();
}
