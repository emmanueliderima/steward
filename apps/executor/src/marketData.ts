import { config } from "./config";

export interface PriceData {
  [tokenAddress: string]: number; // USD price
}

export interface TokenMeta {
  address: string;
  symbol: string;
}

// Maps your on-chain asset addresses to CoinGecko IDs. RWA tokens generally
// aren't on CoinGecko — extend this with whatever price source your specific
// RWA token uses (its own oracle, a DEX pool price, or a hardcoded testnet
// value while you're still on a mock token).
const COINGECKO_IDS: Record<string, string> = {
  // "0xBTC_TOKEN_ADDRESS": "bitcoin",
  // "0xETH_TOKEN_ADDRESS": "ethereum",
};

export async function fetchPrices(tokens: TokenMeta[]): Promise<PriceData> {
  const ids = tokens
    .map((token) => COINGECKO_IDS[token.address.toLowerCase()])
    .filter(Boolean);

  const prices: PriceData = {};
  if (ids.length > 0) {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${[...new Set(ids)].join(",")}&vs_currencies=usd`;
    const res = await fetch(url, {
      headers: config.marketData.coingeckoApiKey
        ? { "x-cg-demo-api-key": config.marketData.coingeckoApiKey }
        : {},
    });

    if (!res.ok) throw new Error(`CoinGecko request failed: ${res.status}`);
    const json = (await res.json()) as Record<string, { usd: number }>;

    for (const token of tokens) {
      const cgId = COINGECKO_IDS[token.address.toLowerCase()];
      if (cgId && json[cgId]) prices[token.address] = json[cgId].usd;
    }
  }

  if (config.okx.useMockRouter) {
    for (const token of tokens) {
      const mockPrice = config.marketData.mockPrices[token.symbol];
      if (prices[token.address] === undefined && mockPrice !== undefined) {
        prices[token.address] = mockPrice;
      }
    }
  }

  return prices;
}

/**
 * Lightweight sentiment signal to feed the AI agent alongside price data.
 * Stubbed for the hackathon — swap in a real source (X/Twitter API, a news
 * aggregator, the Fear & Greed Index) when you have time. Returning a neutral
 * default keeps the rest of the pipeline working if this isn't wired up yet.
 */
export async function fetchSentiment(): Promise<{ score: number; summary: string }> {
  return { score: 0.5, summary: "Sentiment source not yet configured — neutral default." };
}
