import { GoogleGenAI } from "@google/genai";
import { config, activeAiModel } from "./config";
import type { AllocationProposal } from "@steward/shared-types";

const gemini = new GoogleGenAI({ apiKey: config.ai.geminiApiKey });

interface AssetInfo {
  address: string;
  symbol: string;
  priceUsd: number;
  maxAllocationBps: number;
}

interface ProposalInput {
  vaultAddress: string;
  assets: AssetInfo[];
  currentWeightsBps: Record<string, number>;
  sentiment: { score: number; summary: string };
}

// The model's response must be parseable JSON matching this exact shape —
// enforced by responseMimeType below AND the runtime validation further down.
// Belt and suspenders: JSON mode guarantees valid JSON syntax, not that the
// AI followed the prompt's semantic instructions (weights summing to 10000,
// staying under each asset's cap) — that's still checked separately.
interface RawAiResponse {
  targetWeightsBps: Record<string, number>;
  reasoning: string;
  confidence: number;
}

function buildProposal(
  input: ProposalInput,
  targetWeightsBps: Record<string, number>,
  reasoning: string,
  confidence: number,
  allocationSource: string
): AllocationProposal {
  return {
    vaultAddress: input.vaultAddress as `0x${string}`,
    proposedAt: new Date().toISOString(),
    targetWeights: targetWeightsBps as Record<`0x${string}`, number>,
    reasoning,
    confidence,
    marketSnapshot: {
      prices: Object.fromEntries(input.assets.map((a) => [a.address, a.priceUsd])) as Record<
        `0x${string}`,
        number
      >,
      sentimentScore: input.sentiment.score,
      sourcesUsed: ["coingecko", "sentiment-stub", allocationSource],
    },
  };
}

export async function proposeAllocation(input: ProposalInput): Promise<AllocationProposal> {
  const totalCapacityBps = input.assets.reduce((sum, asset) => sum + asset.maxAllocationBps, 0);
  if (totalCapacityBps < 10_000) {
    throw new Error(
      `Vault allocation caps total ${totalCapacityBps}bps, so no 10000bps portfolio is possible`
    );
  }

  // If the caps total exactly 100%, the owner's constraints already define
  // the only feasible allocation; there is no discretionary choice for AI.
  if (totalCapacityBps === 10_000) {
    return buildProposal(
      input,
      Object.fromEntries(input.assets.map((asset) => [asset.address, asset.maxAllocationBps])),
      "The owner's allocation caps total exactly 100%, so they uniquely determine this allocation.",
      1,
      "owner-constraints"
    );
  }

  const assetLines = input.assets
    .map(
      (a) =>
        `- ${a.symbol} (${a.address}): price $${a.priceUsd}, current weight ${
          input.currentWeightsBps[a.address] ?? 0
        }bps, owner's max allowed weight ${a.maxAllocationBps}bps`
    )
    .join("\n");

  const prompt = `You are a portfolio allocation assistant for a crypto vault called Steward.
The vault owner has set hard on-chain limits (max weight per asset) — you MUST NOT propose
a weight above any asset's stated maximum. Maximums are inclusive: a proposed weight may equal
its maximum when needed to produce a complete 10000bps portfolio.

Assets in this vault:
${assetLines}

Market sentiment: ${input.sentiment.summary} (score ${input.sentiment.score}, 0=fearful, 1=greedy)

Propose a target allocation across these assets, in basis points (bps), summing to exactly 10000.
Include exactly one entry for every listed asset, using each address exactly as written above.
CAUTION: RESPOND WITH ONLY VALID JSON, NO MARKDOWN FENCES, NO PREAMBLE, IN THIS EXACT SHAPE:
{
  "targetWeightsBps": { "<asset_address>": <bps>, ... },
  "reasoning": "<2-4 sentences explaining the allocation call>",
  "confidence": <number between 0 and 1>
}
  

EXAMPLE RESPONSE:
{
  "targetWeightsBps": {
    "0x1234567890abrdef1234560890abcdef12345678": 4000,
    "0x1234567890abcdef1234567890abcdef12345679": 3000,
    "0x1234567890abcdef1234567890abcdef12345680": 3000
  },
  "reasoning": "Based on the current market sentiment and the maximum allocation limits set by the vault owner, I have proposed a target allocation that stays comfortably under the max for each asset. The bullish market sentiment suggests a higher allocation to ETH, while BTC and xGold are allocated more conservatively.",
  "confidence": 0.85
}

NOTE: Your response must be valid JSON, parsable by JSON.parse(), and must match the shape above exactly.
Your reasoning should be concise and focused on the market sentiment and asset prices, and should not include any disclaimers or legal language.

`;

  const response = await gemini.models.generateContent({
    model: activeAiModel,
    contents: prompt,
    config: {
      // Constrains the actual token generation to valid JSON syntax — a real
      // decoding-time guarantee, not just a prompt instruction the model can
      // ignore. Doesn't guarantee the *shape* matches RawAiResponse, which is
      // why the manual validation below still exists.
      responseMimeType: "application/json",
    },
  });

  const rawText = response.text;
  if (!rawText) {
    throw new Error(`Gemini response had no text content (model: ${activeAiModel})`);
  }

  let parsed: RawAiResponse;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Failed to parse Gemini response as JSON (model: ${activeAiModel}): ${rawText}`);
  }

  // Normalize keys back to the exact on-chain spelling and reject omitted,
  // unknown, fractional, or otherwise malformed weights.
  if (!parsed.targetWeightsBps || typeof parsed.targetWeightsBps !== "object") {
    throw new Error("AI proposal did not include targetWeightsBps");
  }
  const assetsByLowerAddress = new Map(
    input.assets.map((asset) => [asset.address.toLowerCase(), asset])
  );
  const normalizedWeights: Record<string, number> = {};
  for (const [address, weight] of Object.entries(parsed.targetWeightsBps)) {
    const asset = assetsByLowerAddress.get(address.toLowerCase());
    if (!asset) throw new Error(`AI proposal included unknown asset ${address}`);
    if (!Number.isInteger(weight) || weight < 0) {
      throw new Error(`AI proposal included invalid weight ${weight} for ${asset.symbol}`);
    }
    normalizedWeights[asset.address] = weight;
  }
  for (const asset of input.assets) {
    if (normalizedWeights[asset.address] === undefined) {
      throw new Error(`AI proposal omitted ${asset.symbol} (${asset.address})`);
    }
  }

  const totalBps = Object.values(normalizedWeights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(totalBps - 10000) > 50) {
    throw new Error(`AI proposal weights sum to ${totalBps}bps, expected ~10000`);
  }
  for (const asset of input.assets) {
    const proposed = normalizedWeights[asset.address]!;
    if (proposed > asset.maxAllocationBps) {
      throw new Error(
        `AI proposed ${proposed}bps for ${asset.symbol}, exceeds owner's max of ${asset.maxAllocationBps}bps`
      );
    }
  }
  if (parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error(`AI confidence ${parsed.confidence} out of range`);
  }

  return buildProposal(
    input,
    normalizedWeights,
    parsed.reasoning,
    parsed.confidence,
    `gemini:${activeAiModel}`
  );
}
