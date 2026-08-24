import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function positiveNumber(key: string, fallback: number): number {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number`);
  }
  return value;
}

const chainId = Number(process.env.XLAYER_CHAIN_ID ?? 196);
const networkRpcUrl =
  chainId === 196 ? process.env.XLAYER_MAINNET_RPC_URL : process.env.XLAYER_TESTNET_RPC_URL;
const rpcUrls = [...new Set([process.env.XLAYER_RPC_URL, networkRpcUrl].filter(Boolean))] as string[];
if (rpcUrls.length === 0) {
  throw new Error(
    `Missing required env var: XLAYER_RPC_URL or ${
      chainId === 196 ? "XLAYER_MAINNET_RPC_URL" : "XLAYER_TESTNET_RPC_URL"
    }`
  );
}

export const config = {
  rpcUrls,
  vaultFactoryAddress: required("VAULT_FACTORY_ADDRESS"),
  chainId,
  testnetFaucetEnabled:
    chainId !== 196 && process.env.OKX_USE_MOCK_ROUTER === "true",
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 3001),
  coingeckoApiKey: process.env.COINGECKO_API_KEY ?? "",
  mockPrices: {
    mBTC: positiveNumber("MOCK_MBTC_PRICE_USD", 60_000),
    mETH: positiveNumber("MOCK_METH_PRICE_USD", 3_000),
    mRWA: positiveNumber("MOCK_MRWA_PRICE_USD", 100),
  } as Record<string, number>,
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};
