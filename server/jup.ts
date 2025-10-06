import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import axios from "axios";
import { Escrow } from "../tests/utils/fn";
import {
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { payer, rpc } from "./app";
import { logger, tokenMap } from "./utils";

export async function get_quote(
  input_mint: string,
  output_mint: string,
  amount: number,
  slippageBps: number = 0,
  platformFeeBps: number = 0
): Promise<{ inAmount: string; outAmount: string; swapUsdValue: string }> {
  const quote_url =
    `https://lite-api.jup.ag/swap/v1/quote?` +
    `inputMint=${input_mint}&outputMint=${output_mint}` +
    `&amount=${amount}&slippageBps=${slippageBps}&platformFeeBps=${platformFeeBps}`;

  const quote = await axios.get(quote_url);

  return {
    inAmount: quote.data.inAmount,
    outAmount: quote.data.outAmount,
    swapUsdValue: quote.data.swapUsdValue,
  };
}

const fee = new PublicKey("feeSsye1xpD4zaxVh19n92abi3ZyWngAD47Z3ygPGPA");

export async function get_swap_instruction(
  input_mint: string,
  output_mint: string,
  amount: number,
  swapMode: "ExactOut" | "ExactIn",
  platformFeeBps = 0,
  onlyDirectRoutes: boolean = false,
  slippageBps: number = 0
) {
  const fee_acc = await create_fee_ata(new PublicKey(input_mint));

  let quote_url =
    `https://lite-api.jup.ag/swap/v1/quote?` +
    `inputMint=${input_mint}&outputMint=${output_mint}` +
    `&amount=${amount}&swapMode=${swapMode}&slippageBps=${slippageBps}&onlyDirectRoutes=${onlyDirectRoutes}`;

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
}> {
  let tryInAmount = escrow_data.amount.makingAmount.toNumber();
  let tryTakingAmount = escrow_data.amount.takingAmount.toNumber() * 0.999;
  let divisor = 1;

  while (tryInAmount > 0 && tryTakingAmount > 0) {
    const { outAmount, swapUsdValue } = await get_quote(
      inputMint.toString(),
      outputMint.toString(),
      tryInAmount,
      0,
      10
    );

    if (5 > Number(swapUsdValue)) {
      throw new Error("dust transaction swap value is less than 5$");
    }

    if (Number(outAmount) >= tryTakingAmount) {
      return { fill_type: "full", divisor };
    }

    if (divisor !== 1 && Number(outAmount) >= tryTakingAmount) {
      return { fill_type: "partial", divisor };
    }

    divisor *= 2;
    tryInAmount = Math.floor(tryInAmount / 2);
    tryTakingAmount = Math.floor(tryTakingAmount / 2);
  }

  throw new Error("Swap Quote not found to fill the order");
}

async function create_fee_ata(mint: PublicKey) {
  const token = tokenMap.get(mint.toString());

  if (!token) {
    throw new Error(`Token metadata not found for mint ${mint.toBase58()}`);
  }

  const ata = await getAssociatedTokenAddress(
    mint,
    fee,
    true,
    new PublicKey(token.tokenProgram)
  );

  const ata_exist = await rpc.getAccountInfo(ata);

  if (ata_exist) return ata;
  if (ata_exist !== null) return ata;

  logger.info("creating fee token account");

  return await createAssociatedTokenAccount(
    rpc,
    payer,
    mint,
    fee,
    { commitment: "processed" },
    new PublicKey(token.tokenProgram)
  );
}

export async function get_best_slippage(escrow: Escrow, input_amount: number) {
  let slippage_bps = 5;

  let best_slippage = null;

  while (slippage_bps <= 50) {
    const quote_url =
      `https://lite-api.jup.ag/swap/v1/quote?` +
      `inputMint=${escrow.tokens.inputMint.toString()}&outputMint=${escrow.tokens.outputMint.toString()}` +
      `&amount=${input_amount}&slippageBps=${slippage_bps}`;

    console.log(`Trying slippage: ${slippage_bps} bps`);

    try {
      const quote = await axios.get(quote_url);

      let body = {
        userPublicKey: "FFbzGFqJYhxRPTsuAJ8jjjXUTiMhAqZoGRj9x8ZCN6T7",
        payer: "botk1pyb4oXga299ocn1U37xHrYkxty9arWjEL7QJPF",
        quoteResponse: quote.data,
        wrapAndUnwrapSol: false,
      };

      let config = {
        method: "post",
        maxBodyLength: Infinity,
        url: "https://lite-api.jup.ag/swap/v1/swap",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        data: JSON.stringify(body),
      };

      const swap = await axios.request(config);

      const transaction = VersionedTransaction.deserialize(
        Buffer.from(swap.data.swapTransaction, "base64")
      );

      const sim = await rpc.simulateTransaction(transaction, {
        sigVerify: false,
      });

      if (sim.value.err === null) {
        console.log(`✅ Found passing slippage at ${slippage_bps} bps`);
        best_slippage = slippage_bps;
        break;
      } else {
        console.log(`❌ Simulation failed at ${slippage_bps} bps`);
      }
    } catch (err) {
      console.log(`⚠️ Error at slippage ${slippage_bps}:`, err.message);
    }

    slippage_bps += 5;
  }

  if (!best_slippage) {
    console.log("❌ No valid slippage found up to 50 bps");
  }

  console.log(best_slippage);
  return best_slippage;
}
