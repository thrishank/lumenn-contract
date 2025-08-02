import { PublicKey } from "@solana/web3.js";
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
