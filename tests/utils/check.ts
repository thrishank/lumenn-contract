import { assert } from "chai";
import { PublicKey } from "@solana/web3.js";
import { bn } from "@lightprotocol/stateless.js";
import { parseEscrowFromBuffer } from "./fn";
import { PROGRAM_ID } from "./address";
import BN from "bn.js";

/**
 * Asserts the correctness of a parsed escrow account.
 */
export async function assertEscrowState({
  rpc,
  address,
  uniqueId,
  payer,
  inputMint,
  outputMint,
  makingAmount,
  takingAmount,
  slippageBps = 50, // default
}: {
  rpc: ReturnType<typeof import("@lightprotocol/stateless.js")["createRpc"]>;
  address: PublicKey;
  uniqueId: BN;
  payer: PublicKey;
  inputMint: PublicKey;
  outputMint: PublicKey;
  makingAmount: BN;
  takingAmount: BN;
  slippageBps?: number;
}) {
  const account = await rpc.getCompressedAccount(bn(address.toBytes()));
  assert.isDefined(account, "Compressed Account not found");

  assert.equal(
    account.owner.toString(),
    PROGRAM_ID.toString(),
    "Owner mismatch"
  );

  const data = parseEscrowFromBuffer(account?.data?.data!);
  assert.isDefined(data, "Parsed escrow data is undefined");

  assert.isTrue(data.uniqueId.eq(uniqueId), "uniqueId mismatch");
  assert.equal(data.maker.toString(), payer.toString(), "maker mismatch");

  assert.equal(
    data.tokens.inputMint.toString(),
    inputMint.toString(),
    "inputMint mismatch"
  );
  assert.equal(
    data.tokens.outputMint.toString(),
    outputMint.toString(),
    "outputMint mismatch"
  );

  // assert.isTrue(
  //   data.amount.oriMakingAmount.eq(makingAmount),
  //   "oriMakingAmount mismatch"
  // );
  // assert.isTrue(
  //   data.amount.oriTakingAmount.eq(takingAmount),
  //   "oriTakingAmount mismatch"
  // );

  assert.isTrue(
    data.amount.makingAmount.eq(makingAmount),
    "makingAmount mismatch, data: " +
      data.amount.makingAmount +
      "your data: " +
      makingAmount
  );
  assert.isTrue(
    data.amount.takingAmount.eq(takingAmount),
    "takingAmount mismatch"
  );

  assert.equal(data.slippageBps, slippageBps, "slippageBps mismatch");
}

export async function assertEscrowDoesNotExist({
  rpc,
  address,
}: {
  rpc: ReturnType<typeof import("@lightprotocol/stateless.js")["createRpc"]>;
  address: PublicKey;
}) {
  let account = null;
  try {
    account = await rpc.getCompressedAccount(bn(address.toBytes()));
  } catch (e) {
    // Expected if account is removed
  }
  assert.isNotOk(account, "Escrow account should not exist after cancellation");
}
