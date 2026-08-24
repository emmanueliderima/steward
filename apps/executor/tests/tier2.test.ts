import { describe, it, expect, mock } from "bun:test";

// config.ts validates every env var eagerly on import — chain RPC, vault
// factory, executor key, database URL, OKX creds — even though this test
// only exercises the AI logic. These have to be set, with dummy values,
// before aiAgent.ts (which imports config.ts) is loaded below. This is a
// real cost of the current one-object config design, not incidental test
// boilerplate — see the note in aiAgent.ts's own file if this list drifts
// out of sync with what config.ts actually requires.
process.env.GEMINI_API_KEY ??= "test-key";
process.env.XLAYER_RPC_URL ??= "http://localhost:8545";
process.env.VAULT_FACTORY_ADDRESS ??= "0x0000000000000000000000000000000000000001";
process.env.EXECUTOR_PRIVATE_KEY ??= `0x${"1".repeat(64)}`;
process.env.DATABASE_URL ??= "postgres://localhost:5432/test";
process.env.OKX_USE_MOCK_ROUTER ??= "true";
process.env.MOCK_ROUTER_ADDRESS ??= "0x0000000000000000000000000000000000000002";

// Set by each test right before calling proposeAllocation(). The mock class
// below reads it at call time, so a `let` (not `const`) works fine here —
// closures capture the binding, not a snapshot of its value.
let nextResponseText: string | undefined;

mock.module("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async () => ({ text: nextResponseText }),
    };
  },
}));

// Must be a dynamic import, after the env vars above are set and the mock is
// registered — a static top-level `import` would be hoisted ahead of both,
// and config.ts's required() calls would throw before this file's own setup
// ever ran.
const { proposeAllocation } = await import("../src/aiAgent");

type HexAddress = `0x${string}`;

const baseInput = {
  vaultAddress: "0xaa52c2b9e6a5c3f1d4b8e7a9c1f2d3e4b5a6c7d8" as HexAddress,
  assets: [
    { address: "0xbtc0000000000000000000000000000000000001" as HexAddress, symbol: "mBTC", priceUsd: 60000, maxAllocationBps: 6000 },
    { address: "0xeth0000000000000000000000000000000000002" as HexAddress, symbol: "mETH", priceUsd: 3000, maxAllocationBps: 6000 },
    { address: "0xrwa0000000000000000000000000000000000003" as HexAddress, symbol: "mRWA", priceUsd: 100, maxAllocationBps: 4000 },
  ],
  currentWeightsBps: {
    "0xbtc0000000000000000000000000000000000001": 5000,
    "0xeth0000000000000000000000000000000000002": 3000,
    "0xrwa0000000000000000000000000000000000003": 2000,
  },
  sentiment: { score: 0.5, summary: "Neutral market conditions." },
};

describe("proposeAllocation", () => {
  it("derives the only feasible allocation when owner caps total exactly 10000bps", async () => {
    nextResponseText = undefined;
    const constrainedInput = {
      ...baseInput,
      assets: [
        { ...baseInput.assets[0]!, maxAllocationBps: 6000 },
        { ...baseInput.assets[2]!, maxAllocationBps: 4000 },
      ],
    };

    const proposal = await proposeAllocation(constrainedInput);

    expect(proposal.targetWeights[constrainedInput.assets[0]!.address]).toBe(6000);
    expect(proposal.targetWeights[constrainedInput.assets[1]!.address]).toBe(4000);
    expect(proposal.marketSnapshot.sourcesUsed).toContain("owner-constraints");
  });

  it("returns a well-formed proposal for a valid response", async () => {
    nextResponseText = JSON.stringify({
      targetWeightsBps: {
        "0xbtc0000000000000000000000000000000000001": 5500,
        "0xeth0000000000000000000000000000000000002": 3500,
        "0xrwa0000000000000000000000000000000000003": 1000,
      },
      reasoning: "Shifting toward BTC and ETH given neutral sentiment.",
      confidence: 0.72,
    });

    const proposal = await proposeAllocation(baseInput);

    expect(proposal.vaultAddress).toBe(baseInput.vaultAddress);
    expect(proposal.confidence).toBe(0.72);
    expect(proposal.reasoning).toContain("BTC");
    expect(proposal.targetWeights["0xbtc0000000000000000000000000000000000001"]).toBe(5500);
    expect(proposal.marketSnapshot.sourcesUsed.some((s) => s.startsWith("gemini:"))).toBe(true);
  });

  it("throws when weights don't sum to ~10000bps", async () => {
    nextResponseText = JSON.stringify({
      targetWeightsBps: {
        "0xbtc0000000000000000000000000000000000001": 5000,
        "0xeth0000000000000000000000000000000000002": 3000,
        "0xrwa0000000000000000000000000000000000003": 1000, // sums to 9000, not ~10000
      },
      reasoning: "Bad math.",
      confidence: 0.5,
    });

    await expect(proposeAllocation(baseInput)).rejects.toThrow(/sum to/);
  });

  it("throws when a proposed weight exceeds the owner's on-chain cap", async () => {
    nextResponseText = JSON.stringify({
      targetWeightsBps: {
        "0xbtc0000000000000000000000000000000000001": 7000, // cap is 6000
        "0xeth0000000000000000000000000000000000002": 2000,
        "0xrwa0000000000000000000000000000000000003": 1000,
      },
      reasoning: "Overconfident in BTC.",
      confidence: 0.9,
    });

    await expect(proposeAllocation(baseInput)).rejects.toThrow(/exceeds owner's max/);
  });

  it("throws when confidence is out of range", async () => {
    nextResponseText = JSON.stringify({
      targetWeightsBps: {
        "0xbtc0000000000000000000000000000000000001": 5000,
        "0xeth0000000000000000000000000000000000002": 3000,
        "0xrwa0000000000000000000000000000000000003": 2000,
      },
      reasoning: "Overconfident, literally.",
      confidence: 1.4,
    });

    await expect(proposeAllocation(baseInput)).rejects.toThrow(/confidence/i);
  });

  it("throws a clear error when the response isn't valid JSON", async () => {
    nextResponseText = "sure, here's an allocation: 55% BTC, 35% ETH, 10% RWA";

    await expect(proposeAllocation(baseInput)).rejects.toThrow(/parse Gemini response/);
  });

  it("throws when Gemini returns no text at all", async () => {
    nextResponseText = undefined;

    await expect(proposeAllocation(baseInput)).rejects.toThrow(/no text content/);
  });
});
