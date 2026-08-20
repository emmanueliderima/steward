import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const config = {
  chain: {
    rpcUrl: required("XLAYER_RPC_URL"),
    vaultFactoryAddress: required("VAULT_FACTORY_ADDRESS"),
    executorPrivateKey: required("EXECUTOR_PRIVATE_KEY"),
  },
  db: {
    connectionString: required("DATABASE_URL"),
  },
  ai: {
    openrouterApiKey: required("OPENROUTER_API_KEY"),
    // "test" uses OpenRouter's free auto-router so you're never blocked by a
    // specific free model rotating out mid-hackathon. "prod" pins an explicit,
    // stable model for the demo and beyond — set AI_ENV=prod to switch.
    environment: (process.env.AI_ENV as "test" | "prod") ?? "test",
    testModel: process.env.OPENROUTER_MODEL_TEST ?? "openrouter/free",
    prodModel: process.env.OPENROUTER_MODEL_PROD ?? "anthropic/claude-sonnet-4.6",
  },
  okx: {
    apiKey: required("OKX_API_KEY"),
    apiSecret: required("OKX_API_SECRET"),
    apiPassphrase: required("OKX_API_PASSPHRASE"),
    chainIndex: process.env.OKX_CHAIN_INDEX ?? "196",
  },
  marketData: {
    coingeckoApiKey: process.env.COINGECKO_API_KEY ?? "",
  },
  cron: process.env.REBALANCE_CRON ?? "0 * * * *",
};

export const activeAiModel =
  config.ai.environment === "prod" ? config.ai.prodModel : config.ai.testModel;