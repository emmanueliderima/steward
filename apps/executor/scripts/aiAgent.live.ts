import { proposeAllocation } from "../src/aiAgent";
import { activeAiModel } from "../src/config";

// Hits the REAL Gemini API — costs a real request against your GEMINI_API_KEY
// (and real quota/billing if AI_ENV=prod). Deliberately named without
// ".test.ts" so Bun's default `bun test` directory scan skips it; run it
// explicitly with `bun run test:live` once you have a real key in
// apps/executor/.env.
//
// This isn't a strict correctness test — the model's exact wording and
// numbers will differ every run, and that's fine. Its job is to show you the
// real response so you can eyeball it, and to catch the model failing to
// produce parsable/valid output against your actual prompt on your actual
// chosen model — which is exactly what proposeAllocation() already checks
// internally (JSON syntax, weights summing correctly, nothing over cap,
// confidence in range). If any of that fails, this test fails with the same
// error the executor itself would hit in production.


const input = {
      vaultAddress: "0xaa52c2b9e6a5c3f1d4b8e7a9c1f2d3e4b5a6c7d8",
      assets: [
        {
          address: "0xbtc0000000000000000000000000000000000001",
          symbol: "mBTC",
          priceUsd: 60000,
          maxAllocationBps: 6000,
        },
        {
          address: "0xeth0000000000000000000000000000000000002",
          symbol: "mETH",
          priceUsd: 3000,
          maxAllocationBps: 6000,
        },
        {
          address: "0xrwa0000000000000000000000000000000000003",
          symbol: "mRWA",
          priceUsd: 100,
          maxAllocationBps: 4000,
        },
      ],
      currentWeightsBps: {
        "0xbtc0000000000000000000000000000000000001": 5000,
        "0xeth0000000000000000000000000000000000002": 3000,
        "0xrwa0000000000000000000000000000000000003": 2000,
      },
      sentiment: {
        score: 0.65,
        summary: "Mildly bullish — risk appetite picking up across majors.",
  },
};

const proposal = await proposeAllocation(input);

console.log(proposal);

console.log(`\n--- Gemini (${activeAiModel}) response ---`);
console.log("targetWeights:", proposal.targetWeights);
console.log("reasoning:", proposal.reasoning);
console.log("confidence:", proposal.confidence);
console.log("-----------------------------------\n");