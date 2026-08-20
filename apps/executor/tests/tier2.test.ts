
/**
 * Tier 2 — executor logic, no chain needed
aiAgent.ts (the OpenRouter call + validation) and rebalancePlanner.ts (the diff/match math) can both be exercised with fixture data and no deployed contract at all — just call proposeAllocation() with a fake ProposalInput and see what comes back.
Worth doing before you touch a testnet, since it isolates AI response flakiness from chain issues when something breaks.
*/
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
import type { AllocationProposal } from "@steward/shared-types";
import type { ProposalInput } from "../src/aiAgent";
import { proposeAllocation } from "../src/aiAgent";
import { config } from "../src/config";


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

const proposalInput: ProposalInput = {
    vaultAddress: "0x1234567890abcdef1234567890abcdef12345678",
    assets: [
        {
            address: "0x1234567890abcdef1234567890abcdef12345679",
            symbol: "BTC",
            priceUsd: 35000,
            maxAllocationBps: 3000
        },
        {
            address: "0x1234567890abrdef1234560890abcdef12345678",
            symbol: "ETH",
            priceUsd: 3600,
            maxAllocationBps: 5000
        },
        {
            address: "0x1234567890abcdef1234567890abcdef12345680",
            symbol: "xGold",
            priceUsd: 8000,
            maxAllocationBps: 2000
        }
    ],
    currentWeightsBps: {
        "0x1234567090abcdef1334567890abcdef12345678": 3000
    },
    sentiment: {
        score: 0.8,
        summary: "Bullish market sentiment"
    }
};

async function testProposeAllocation() {

    const result = await proposeAllocation(proposalInput);
    return result;
}


async function testAI(input: ProposalInput){

    const assetLines = input.assets
    .map(
      (a) =>
        `- ${a.symbol} (${a.address}): price $${a.priceUsd}, current weight ${
          input.currentWeightsBps[a.address] ?? 0
        }bps, owner's max allowed weight ${a.maxAllocationBps}bps`
    )
    .join("\n");


  const prompt = `
  
  You are a portfolio allocation assistant for a crypto vault called Steward.
The vault owner has set hard on-chain limits (max weight per asset) — you MUST NOT propose
a weight above any asset's stated maximum. On-chain checks will reject the proposal if you do,
so stay comfortably under the max, don't target it exactly.
  
  
  Assets in this vault:
${assetLines}

Market sentiment: ${input.sentiment.summary} (score ${input.sentiment.score}, 0=fearful, 1=greedy)
Propose a target allocation across these assets, in basis points (bps), summing to 10000.
  
RETURN ONLY VALID JSON, NO MARKDOWN FENCES, NO PREAMBLE, IN THIS EXACT SHAPE:

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
    
  CAUTION: Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape. If you do not have enough information to provide a confident allocation, respond with a confidence of 0 and an empty targetWeightsBps object. If you are unsure of what to respond, respond with a confidence of 0 and an empty targetWeightsBps object.
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
      model: config.ai.testModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`OpenRouter request failed`);
    throw new Error(`OpenRouter request failed (${response.status}) on model ${config.ai.testModel}: ${errBody}`);
  }

  const json = await response.json() as ChatCompletionResponse;
  
  json.choices.forEach((choice, index) => {
    console.log(`  Choice: ${choice.message.content}`);
  });
}

testProposeAllocation()
    .then((result) => {
        console.log("Propose Allocation Result:", result);
    })
    .catch((error) => {
        console.error("Error during proposeAllocation test:", error);
    });
