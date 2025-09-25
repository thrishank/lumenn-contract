import { PublicKey } from "@solana/web3.js";
import axios from "axios";
import { Escrow } from "../tests/utils/fn";
import {
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { payer, rpc } from "./app";
import { tokenMap } from "./utils";

export async function get_quote(
  input_mint: string,
  output_mint: string,
  amount: number
): Promise<{ inAmount: string; outAmount: string }> {
  const quote_url =
    `https://lite-api.jup.ag/swap/v1/quote?` +
    `inputMint=${input_mint}&outputMint=${output_mint}` +
    `&amount=${amount}&slippageBps=0`;

  const quote = await axios.get(quote_url);

  return {
    inAmount: quote.data.inAmount,
    outAmount: quote.data.outAmount,
  };
}

const fee = new PublicKey("feeSsye1xpD4zaxVh19n92abi3ZyWngAD47Z3ygPGPA");

export async function get_swap_instruction(
  input_mint: string,
  output_mint: string,
  amount: number,
  swapMode: "ExactOut" | "ExactIn",
  platformFeeBps = 0,
  onlyDirectRoutes: boolean = false
) {
  const fee_acc = await create_fee_ata(new PublicKey(input_mint));

  let quote_url =
    `https://lite-api.jup.ag/swap/v1/quote?` +
    `inputMint=${input_mint}&outputMint=${output_mint}` +
    `&amount=${amount}&swapMode=${swapMode}&slippageBps=0&onlyDirectRoutes=${onlyDirectRoutes}`;

  if (platformFeeBps !== 0) {
    quote_url += `&platformFeeBps=${platformFeeBps}`;
  }

  const quote = await axios.get(quote_url);

  let body = {
    userPublicKey: "FFbzGFqJYhxRPTsuAJ8jjjXUTiMhAqZoGRj9x8ZCN6T7",
    quoteResponse: quote.data,
    ...(platformFeeBps !== 0 ? { feeAccount: fee_acc.toString() } : {}),
    // NOTE: token account is the ata of fee and input mint
  };

  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url: "https://lite-api.jup.ag/swap/v1/swap-instructions",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    data: JSON.stringify(body),
  };
  const swap = await axios.request(config);

  const instruction_data = swap.data.swapInstruction.data;
  const accounts = swap.data.swapInstruction.accounts.map((acc: any) => ({
    pubkey: new PublicKey(acc.pubkey),
    isWritable: acc.isWritable,
    isSigner: false,
  }));

  return {
    inAmount: quote.data.inAmount,
    outAmount: quote.data.outAmount,
    priceImpactPct: quote.data.priceImpactPct,
    instruction_data,
    accounts,
    alt: swap.data.addressLookupTableAddresses,
  };
}

export async function get_price(input_mint: string, output_mint: string) {
  const url = `https://lite-api.jup.ag/price/v3?ids=${input_mint},${output_mint}`;
  const res = await axios.get(url);

  const inputPrice = res.data[input_mint]?.usdPrice;
  const outputPrice = res.data[output_mint]?.usdPrice;

  if (!inputPrice || !outputPrice) {
    throw new Error("Could not fetch prices for given tokens");
  }

  const current_ratio = inputPrice / outputPrice;

  return { current_ratio, inputPrice, outputPrice };
}

export async function determineFillType(
  escrow_data: Escrow,
  inputMint: PublicKey,
  outputMint: PublicKey
): Promise<{
  fill_type: "full" | "partial";
  divisor: number;
  instruction_data: any;
  accounts: any[];
  alt: any[];
}> {
  let tryInAmount = escrow_data.amount.makingAmount.toNumber();
  let tryTakingAmount = escrow_data.amount.takingAmount.toNumber();
  let divisor = 1;

  while (tryInAmount > 0 && tryTakingAmount > 0) {
    const { outAmount, instruction_data, accounts, alt } =
      await get_swap_instruction(
        inputMint.toString(),
        outputMint.toString(),
        tryInAmount,
        "ExactIn",
        10
      );

    if (outAmount >= escrow_data.amount.takingAmount.toNumber()) {
      return { fill_type: "full", divisor, instruction_data, accounts, alt };
    }

    if (outAmount >= tryTakingAmount) {
      return { fill_type: "partial", divisor, instruction_data, accounts, alt };
    }

    divisor *= 2;
    tryInAmount = Math.floor(tryInAmount / 2);
    tryTakingAmount = Math.floor(tryTakingAmount / 2);
  }

  throw new Error("Swap Quote not found to fill the order");
}

async function create_fee_ata(mint: PublicKey) {
  const ata = await getAssociatedTokenAddress(mint, fee);

  const ata_exist = await rpc.getAccountInfo(ata);

  if (ata_exist) return ata;

  const token = tokenMap.get(mint.toString());

  if (!token) {
    throw new Error(`Token metadata not found for mint ${mint.toBase58()}`);
  }

  return await createAssociatedTokenAccount(
    rpc,
    payer,
    mint,
    fee,
    null,
    new PublicKey(token.tokenProgram)
  );
}
