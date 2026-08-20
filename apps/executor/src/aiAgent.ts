import { config, activeAiModel } from "./config";
import type { AllocationProposal } from "@steward/shared-types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface AssetInfo {
  address: string;
  symbol: string;
  priceUsd: number;
  maxAllocationBps: number;
}

export interface ProposalInput {
  vaultAddress: string;
  assets: AssetInfo[];
  currentWeightsBps: Record<string, number>;
  sentiment: { score: number; summary: string };
}

interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  provider: string;
  system_fingerprint: string | null;
  service_tier: string | null;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
}

interface ChatCompletionChoice {
  index: number;
  logprobs: unknown | null;
  finish_reason: string | null;
  native_finish_reason: string | null;
  message: ChatCompletionMessage;
}

interface ChatCompletionMessage {
  role: "assistant";
  content: string | null;
}

interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: number;
  is_byok: boolean;
  prompt_tokens_details: {
    cached_tokens: number;
    cache_write_tokens: number;
    audio_tokens: number;
    video_tokens: number;
  };
  cost_details: {
    upstream_inference_cost: number;
    upstream_inference_prompt_cost: number;
    upstream_inference_completions_cost: number;
  };
  completion_tokens_details: {
    reasoning_tokens: number;
    image_tokens: number;
    audio_tokens: number;
  };
}

interface RawAiResponse {
  targetWeightsBps: Record<string, number>;
  reasoning: string;
  confidence: number;
}

export async function proposeAllocation(input: ProposalInput): Promise<AllocationProposal> {
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
a weight above any asset's stated maximum. On-chain checks will reject the proposal if you do,
so stay comfortably under the max, don't target it exactly.

Assets in this vault:
${assetLines}

Market sentiment: ${input.sentiment.summary} (score ${input.sentiment.score}, 0=fearful, 1=greedy)

Propose a target allocation across these assets, in basis points (bps), summing to 10000.
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

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.ai.openrouterApiKey}`,
      "Content-Type": "application/json",
      // Optional but recommended by OpenRouter for their own analytics/rankings —
      // harmless to leave as placeholders if you don't have a public URL yet.
      "HTTP-Referer": "https://steward.vault",
      "X-Title": "Steward",
    },
    body: JSON.stringify({
      model: activeAiModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`OpenRouter request failed`);
    throw new Error(`OpenRouter request failed (${response.status}) on model ${activeAiModel}: ${errBody}`);
  }

  const json = await response.json() as ChatCompletionResponse;
  const rawText: string | undefined = json.choices[0]?.message?.content ?? undefined;
  if (!rawText) {
    throw new Error(`OpenRouter response had no content (model: ${activeAiModel}): ${JSON.stringify(json)}`);
  }

  let parsed: RawAiResponse;
  try {
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse AI response as JSON (model: ${activeAiModel}): ${rawText}`);
  }

  // Runtime validation — never trust the model's output shape blindly, since
  // this feeds directly into what gets submitted on-chain.
  const totalBps = Object.values(parsed.targetWeightsBps).reduce((sum, v) => sum + v, 0);
  if (Math.abs(totalBps - 10000) > 50) {
    throw new Error(`AI proposal weights sum to ${totalBps}bps, expected ~10000`);
  }
  for (const asset of input.assets) {
    const proposed = parsed.targetWeightsBps[asset.address] ?? 0;
    if (proposed > asset.maxAllocationBps) {
      throw new Error(
        `AI proposed ${proposed}bps for ${asset.symbol}, exceeds owner's max of ${asset.maxAllocationBps}bps`
      );
    }
  }
  if (parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error(`AI confidence ${parsed.confidence} out of range`);
  }

  return {
    vaultAddress: input.vaultAddress as `0x${string}`,
    proposedAt: new Date().toISOString(),
    targetWeights: parsed.targetWeightsBps as Record<`0x${string}`, number>,
    reasoning: parsed.reasoning,
    confidence: parsed.confidence,
    marketSnapshot: {
      prices: Object.fromEntries(input.assets.map((a) => [a.address, a.priceUsd])) as Record<
        `0x${string}`,
        number
      >,
      sentimentScore: input.sentiment.score,
      sourcesUsed: ["coingecko", "sentiment-stub", `openrouter:${activeAiModel}`],
    },
  };
}