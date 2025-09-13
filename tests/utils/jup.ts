import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import axios from "axios";

export async function get_swap(
  address: string,
  input_mint: string,
  output_mint: string,
  amount = 2039280,
  swapMode = "ExactOut",
  platformFeeBps = 0
) {
  const quote_url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${input_mint}&outputMint=${output_mint}&amount=${amount}&swapMode=${swapMode}&platformFeeBps=${platformFeeBps}&slippageBps=0`;
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
  return {
    swap: swap.data,
    inAmount: quote.data.inAmount,
    outAmount: quote.data.outAmount,
  };
}

export async function get_swap_instruction() {
  const fee_pubkey = new PublicKey(
    "feeSsye1xpD4zaxVh19n92abi3ZyWngAD47Z3ygPGPA"
  );
  const ata = await getAssociatedTokenAddress(
    new PublicKey("9RzWC4ZS6LdNUP2LwaY7Ztq5sTxgt3dFLp2jjokhm9Vz"),
    fee_pubkey
  );
  const quote_url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=2039280&swapMode=ExactOut&feeAccount=${ata.toString()}`;

  const quote = await axios.get(quote_url);
  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url: "https://lite-api.jup.ag/swap/v1/swap-instructions",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    data: JSON.stringify({
      userPublicKey: "HmTYE1huZakHZn9VwSR6p6mBjGFT8hJUCRC4aWuCCSnd",
      quoteResponse: quote.data,
    }),
  };
  const swap = await axios.request(config);
  const accounts = swap.data.swapInstruction.accounts.map((acc: any) => ({
    pubkey: new PublicKey(acc.pubkey),
    isWritable: acc.isWritable,
    isSigner: false,
  }));
  return { accounts, alt: swap.data.addressLookupTableAddresses };
}
