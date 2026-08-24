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

const useMockRouter = process.env.OKX_USE_MOCK_ROUTER === "true";
const chainId = positiveNumber("XLAYER_CHAIN_ID", 196);
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
  chain: {
    rpcUrls,
    chainId,
    vaultFactoryAddress: required("VAULT_FACTORY_ADDRESS"),
    executorPrivateKey: required("EXECUTOR_PRIVATE_KEY"),
  },
  db: {
    connectionString: required("DATABASE_URL"),
  },
  ai: {
    geminiApiKey: required("GEMINI_API_KEY"),
    // "test" uses Gemini Flash — fast, cheap, generous free quota on an AI
    // Studio key. "prod" pins Gemini Pro for the demo and beyond — set
    // AI_ENV=prod to switch. Same pattern as before, just Gemini model IDs
    // instead of OpenRouter slugs.
    environment: (process.env.AI_ENV as "test" | "prod") ?? "test",
    testModel: process.env.GEMINI_MODEL_TEST ?? "gemini-2.5-flash",
    prodModel: process.env.GEMINI_MODEL_PROD ?? "gemini-2.5-pro",
  },
  okx: {
    useMockRouter,
    mockRouterAddress: useMockRouter ? required("MOCK_ROUTER_ADDRESS") : "",
    apiKey: useMockRouter ? process.env.OKX_API_KEY ?? "" : required("OKX_API_KEY"),
    apiSecret: useMockRouter ? process.env.OKX_API_SECRET ?? "" : required("OKX_API_SECRET"),
    apiPassphrase: useMockRouter
      ? process.env.OKX_API_PASSPHRASE ?? ""
      : required("OKX_API_PASSPHRASE"),
    chainIndex: process.env.OKX_CHAIN_INDEX ?? "196",
  },
  marketData: {
    coingeckoApiKey: process.env.COINGECKO_API_KEY ?? "",
    mockPrices: {
      mBTC: positiveNumber("MOCK_MBTC_PRICE_USD", 60_000),
      mETH: positiveNumber("MOCK_METH_PRICE_USD", 3_000),
      mRWA: positiveNumber("MOCK_MRWA_PRICE_USD", 100),
    } as Record<string, number>,
  },
  cron: process.env.REBALANCE_CRON ?? "0 * * * *",
};

export const activeAiModel =
  config.ai.environment === "prod" ? config.ai.prodModel : config.ai.testModel;
