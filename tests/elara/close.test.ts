import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Elara } from "../../target/types/elara";
import { PublicKey, Signer } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("elara", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.elara as Program<Elara>;
  const payer: Signer = program.provider.wallet!.payer!;

  it("close token 2022 mint", async () => {
    const tx = await program.methods
      .closeProtocolAta()
      .accounts({
        payer: payer.publicKey,
        mint: new PublicKey("GFScxpTQjxgvsnwVA6DYz1XrKeHebpR5o6FLvZFvkMuw"),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    console.log(tx);
  });
});
