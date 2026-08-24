import { config } from "./config";

export interface PriceData {
  [tokenAddress: string]: number;
}

export interface TokenMeta {
  address: string;
  symbol: string;
}

// Keep in sync with apps/executor/src/marketData.ts's COINGECKO_IDS — this
// is intentionally duplicated rather than shared, since api and executor are
// meant to be independently deployable. If that duplication gets annoying,
// it's a reasonable candidate to move into packages/shared-types later.
const COINGECKO_IDS: Record<string, string> = {
  // "0xBTC_TOKEN_ADDRESS": "bitcoin",
  // "0xETH_TOKEN_ADDRESS": "ethereum",
};

// Static fallback for the mock tokens from scripts/deployTestnetMock.ts, so
// the dashboard shows real-looking numbers when pointed at a Tier 3 fixture
// instead of erroring on missing prices.
export async function fetchPrices(tokens: TokenMeta[]): Promise<PriceData> {
  const prices: PriceData = {};

  const cgIds = tokens.map((t) => COINGECKO_IDS[t.address.toLowerCase()]).filter(Boolean);

  if (cgIds.length > 0) {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(",")}&vs_currencies=usd`;
    const res = await fetch(url, {
      headers: config.coingeckoApiKey ? { "x-cg-demo-api-key": config.coingeckoApiKey } : {},
    });
    if (!res.ok) throw new Error(`CoinGecko request failed: ${res.status}`);
    const json = (await res.json()) as Record<string, { usd: number }>;

    for (const t of tokens) {
      const cgId = COINGECKO_IDS[t.address.toLowerCase()];
      if (cgId && json[cgId]) prices[t.address] = json[cgId].usd;
    }
  }

  for (const t of tokens) {
    if (prices[t.address] === undefined && config.mockPrices[t.symbol] !== undefined) {
      prices[t.address] = config.mockPrices[t.symbol]!;
    }
  }

  return prices;
}
