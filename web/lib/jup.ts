export type Token = {
  id: string;
  name: string;
  symbol: string;
  icon: string;
  decimals: number;
  token_program: string;
};

export async function search_tokens(query: string): Promise<Token[]> {
  try {
    const response = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(
        query
      )}`
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();

    const tokens: Token[] = data.map((t: Token) => ({
      id: t.id,
      name: t.name,
      symbol: t.symbol,
      icon: t.icon,
      decimals: t.decimals,
      token_program: t.token_program,
    }));

    return tokens;
  } catch (error) {
    console.error("Error searching tokens:", error);
    return [];
  }
}

export async function fetch_quote(
  inputMint: Token,
  outputMint: Token,
  amount: number
) {
  try {
    const response = await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint.id}&outputMint=${outputMint.id}&amount=${amount}`
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    const current_ratio =
      data.outAmount /
      10 ** outputMint.decimals /
      (data.inAmount / 10 ** inputMint.decimals);
    return {
      outAmount: data.outAmount,
      current_ratio,
    };
  } catch (error) {
    console.error("Error fetching quote:", error);
    return null;
  }
}
