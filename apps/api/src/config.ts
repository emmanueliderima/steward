import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const config = {
  rpcUrl: required("XLAYER_RPC_URL"),
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 3001),
  coingeckoApiKey: process.env.COINGECKO_API_KEY ?? "",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};