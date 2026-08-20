import { config } from "./config";

export interface PriceData {
  [tokenAddress: string]: number; // USD price
}

// Maps your on-chain asset addresses to CoinGecko IDs. RWA tokens generally
// aren't on CoinGecko — extend this with whatever price source your specific
// RWA token uses (its own oracle, a DEX pool price, or a hardcoded testnet
// value while you're still on a mock token).
const COINGECKO_IDS: Record<string, string> = {
  // "0xBTC_TOKEN_ADDRESS": "bitcoin",
  // "0xETH_TOKEN_ADDRESS": "ethereum",
};

export async function fetchPrices(tokenAddresses: string[]): Promise<PriceData> {
  const ids = tokenAddresses
    .map((addr) => COINGECKO_IDS[addr.toLowerCase()])
    .filter(Boolean);

  if (ids.length === 0) return {};

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
  const res = await fetch(url, {
    headers: config.marketData.coingeckoApiKey
      ? { "x-cg-demo-api-key": config.marketData.coingeckoApiKey }
      : {},
  });

  if (!res.ok) throw new Error(`CoinGecko request failed: ${res.status}`);
  const json = (await res.json()) as Record<string, { usd: number }>;

  const prices: PriceData = {};
  for (const [address, cgId] of Object.entries(COINGECKO_IDS)) {
    if (json[cgId]) prices[address] = json[cgId].usd;
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