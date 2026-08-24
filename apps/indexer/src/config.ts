import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function integer(key: string, fallback?: number): number {
  const raw = process.env[key]?.trim();
  if (!raw && fallback === undefined) throw new Error(`Missing required env var: ${key}`);

  const value = Number(raw || fallback);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return value;
}

const requestedChunkSize = integer("LOG_SCAN_CHUNK_SIZE", 100);

export const config = {
  rpcUrl: required("XLAYER_RPC_URL"),
  vaultFactoryAddress: required("VAULT_FACTORY_ADDRESS"),
  databaseUrl: required("DATABASE_URL"),
  pollIntervalMs: Math.max(integer("POLL_INTERVAL_MS", 30000), 1000),
  // X Layer's public RPC rejects eth_getLogs ranges greater than 100 blocks.
  logScanChunkSize: Math.min(Math.max(requestedChunkSize, 1), 100),
  genesisBlock: integer("GENESIS_BLOCK"),
};
