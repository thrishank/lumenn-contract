import { fetch_quote, search_tokens } from "@/lib/jup";

export async function GET() {
  const sol = {
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    id: "So11111111111111111111111111111111111111112",
    name: "Solana",
    symbol: "SOL",
    decimals: 9,
  };
  const usdc = {
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
    id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    name: "USDC",
    symbol: "USDC",
    decimals: 6,
  };
  const data = await fetch_quote(sol, usdc, 200_000_000);
  console.log(data);
  return new Response("Hello, world!");
}
