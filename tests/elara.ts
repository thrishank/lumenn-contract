import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Elara } from "../target/types/elara";
import { Signer } from "@solana/web3.js";

describe("elara", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.elara as Program<Elara>;
  const payer: Signer = program.provider.wallet!.payer!;

  it("test", async () => {});
});
