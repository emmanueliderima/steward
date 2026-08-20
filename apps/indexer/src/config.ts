import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const config = {
  rpcUrl: required("XLAYER_RPC_URL"),
  vaultFactoryAddress: required("VAULT_FACTORY_ADDRESS"),
  databaseUrl: required("DATABASE_URL"),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30000),
  logScanChunkSize: Number(process.env.LOG_SCAN_CHUNK_SIZE ?? 2000),
  genesisBlock: Number(process.env.GENESIS_BLOCK ?? 0),
};