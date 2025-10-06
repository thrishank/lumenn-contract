import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Elara } from "../../target/types/elara";
import {
  Connection,
  Keypair,
  PublicKey,
  Signer,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("elara", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.elara as Program<Elara>;
  const keypair: Signer = program.provider.wallet!.payer!;

  it("close token 2022 mint", async () => {
    const instruction = await program.methods
      .closeProtocolAta()
      .accounts({
        payer: keypair.publicKey,
        mint: new PublicKey("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const rpc = new Connection(
      "https://mainnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d"
    );

    const latestBlockhash = await rpc.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([keypair]);

    const sim = await rpc.simulateTransaction(tx, { sigVerify: false });
    console.log(sim);

    const x = await rpc.sendTransaction(tx);
    console.log(x);
  });
});
