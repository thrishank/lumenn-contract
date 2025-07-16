import * as anchor from "@coral-xyz/anchor";
import axios from "axios";
import { Program } from "@coral-xyz/anchor";
import { Elara } from "../target/types/elara";
import { Keypair, PublicKey, Signer } from "@solana/web3.js";
import { BN } from "bn.js";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

describe("elara", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.elara as Program<Elara>;
  const payer: Signer = program.provider.wallet.payer;

  const input_mint = new PublicKey(
    "J7LM6p22Ef8VhREZzkLToSADrXhAiiQUn3P2BAwo1RSe"
  );
  const output_mint = new PublicKey(
    "9RzWC4ZS6LdNUP2LwaY7Ztq5sTxgt3dFLp2jjokhm9Vz"
  );

  const protocol_vault = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_vault")],
    program.programId
  )[0];

  // it("init order", async () => {
  //   console.clear();
  //   console.log("Initializing order...");
  //   console.log("protocol_vault: ", protocol_vault.toString());
  //   const tx = await program.methods
  //     .initializeOrder({
  //       uniqueId: new BN(324),
  //       makingAmount: new BN(1_000_000_000),
  //       takingAmount: new BN(1_000_000_000),
  //       expiredAt: null,
  //       slippageBps: new BN(100),
  //     })
  //     .accounts({
  //       payer: payer.publicKey,
  //       inputMint: input_mint,
  //       outputMint: output_mint,
  //       order: Keypair.generate().publicKey,
  //       inputTokenProgram: TOKEN_PROGRAM_ID,
  //       outputTokenProgram: TOKEN_PROGRAM_ID,
  //     })
  //     .rpc();
  //   console.log("Order initialized with transaction signature:", tx);
  // });
  //
  // it("Cancel order", async () => {
  //   console.log("Cancelling order...");
  //   const tx = await program.methods
  //     .cancelOrder()
  //     .accounts({
  //       payer: payer.publicKey,
  //       maker: payer.publicKey,
  //       order: Keypair.generate().publicKey,
  //       inputMint: input_mint,
  //       inputTokenProgram: TOKEN_PROGRAM_ID,
  //     })
  //     .rpc();
  //   console.log("Order cancelled with transaction signature:", tx);
  // });

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
});

// when i send a empty data i get the same error in zkcomrpression  program checkout later

async function get_swap(address: string) {
  const quote_url =
    "https://lite-api.jup.ag/swap/v1/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB&amount=10000";
  const quote = await axios.get(quote_url);
  console.log("quote in amount", quote.data.inAmount);
  console.log("quote out amount", quote.data.outAmount);
  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url: "https://lite-api.jup.ag/swap/v1/swap-instructions",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    data: JSON.stringify({
      userPublicKey: address,
      quoteResponse: quote.data,
    }),
  };
  const swap = await axios.request(config);
  return swap.data;
}
