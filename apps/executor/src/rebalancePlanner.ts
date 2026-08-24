import { ethers } from "ethers";
import type { VaultState, SwapInstructionInput } from "./chain";
import { getSwapTransaction } from "./okx";
import { config } from "./config";

const DUST_THRESHOLD_BPS = 50; // ignore drift smaller than 0.5%, not worth a swap

interface PlanInput {
  vaultState: VaultState;
  prices: Record<string, number>; // asset address -> USD price
  targetWeightsBps: Record<string, number>;
}

/**
 * Greedy diff-and-match: assets sitting above target ("excess") get matched
 * against assets sitting below target ("deficit") until both sides are
 * roughly settled. This is intentionally simple — a hackathon-scope planner,
 * not a portfolio-optimal one. It produces a minimal set of swap legs rather
 * than routing every asset through a single hub token.
 */
export function planRebalanceLegs(input: PlanInput): { tokenIn: string; tokenOut: string; amountInUsd: number }[] {
  const { vaultState, prices, targetWeightsBps } = input;

  let totalValueUsd = 0;
  const valueUsd: Record<string, number> = {};
  for (const asset of vaultState.allowedAssets) {
    const price = prices[asset] ?? 0;
    const human = Number(ethers.formatUnits(vaultState.balances[asset]!, vaultState.decimals[asset]));
    valueUsd[asset] = human * price;
    totalValueUsd += valueUsd[asset];
  }

  if (totalValueUsd === 0) return []; // nothing deposited yet

  const excess: { asset: string; usd: number }[] = [];
  const deficit: { asset: string; usd: number }[] = [];

  for (const asset of vaultState.allowedAssets) {
    const currentBps = (valueUsd[asset]! / totalValueUsd) * 10_000;
    const targetBps = targetWeightsBps[asset] ?? 0;
    const driftBps = currentBps - targetBps;

    if (Math.abs(driftBps) < DUST_THRESHOLD_BPS) continue;

    const driftUsd = (Math.abs(driftBps) / 10_000) * totalValueUsd;
    if (driftBps > 0) excess.push({ asset, usd: driftUsd });
    else deficit.push({ asset, usd: driftUsd });
  }

  const legs: { tokenIn: string; tokenOut: string; amountInUsd: number }[] = [];
  let ei = 0;
  let di = 0;

  while (ei < excess.length && di < deficit.length) {
    const e = excess[ei]!;
    const d = deficit[di]!;
    const amount = Math.min(e.usd, d.usd);

    legs.push({ tokenIn: e.asset, tokenOut: d.asset, amountInUsd: amount });

    e.usd -= amount;
    d.usd -= amount;
    if (e.usd < 1) ei++; // under $1 remaining, treat as settled
    if (d.usd < 1) di++;
  }

  return legs;
}

/**
 * Turns a planned leg into a fully-formed SwapInstruction by pulling a live
 * quote/calldata from OKX. slippagePercent is passed through in the same
 * units the vault's maxSlippageBps implies (bps / 100 = percent).
 */
export async function buildSwapInstruction(
  vaultState: VaultState,
  leg: { tokenIn: string; tokenOut: string; amountInUsd: number },
  prices: Record<string, number>,
  targetWeightsBps: Record<string, number>
): Promise<SwapInstructionInput> {
  const priceIn = prices[leg.tokenIn];
  const decimalsIn = vaultState.decimals[leg.tokenIn];
  if (!priceIn || decimalsIn === undefined) {
    throw new Error(`Missing price or decimals for input token ${leg.tokenIn}`);
  }
  const amountInHuman = leg.amountInUsd / priceIn;
  const amountIn = ethers.parseUnits(amountInHuman.toFixed(decimalsIn), decimalsIn);

  if (config.okx.useMockRouter) {
    const priceOut = prices[leg.tokenOut];
    const decimalsOut = vaultState.decimals[leg.tokenOut];
    if (!priceOut || decimalsOut === undefined) {
      throw new Error(`Missing price or decimals for output token ${leg.tokenOut}`);
    }
    if (vaultState.okxRouter.toLowerCase() !== config.okx.mockRouterAddress.toLowerCase()) {
      throw new Error(
        `Mock router mismatch: config has ${config.okx.mockRouterAddress}, vault has ${vaultState.okxRouter}`
      );
    }

    const amountOutHuman = leg.amountInUsd / priceOut;
    const expectedAmountOut = ethers.parseUnits(
      amountOutHuman.toFixed(decimalsOut),
      decimalsOut
    );
    const minAmountOut =
      (expectedAmountOut * BigInt(10_000 - vaultState.maxSlippageBps)) / 10_000n;
    const mockRouter = new ethers.Interface([
      "function swap(address tokenIn,uint256 amountIn,address tokenOut,uint256 amountOut)",
    ]);

    return {
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      amountIn,
      expectedAmountOut,
      minAmountOut,
      targetAllocationBps: targetWeightsBps[leg.tokenOut] ?? 0,
      swapCalldata: mockRouter.encodeFunctionData("swap", [
        leg.tokenIn,
        amountIn,
        leg.tokenOut,
        expectedAmountOut,
      ]),
    };
  }

  const slippagePercent = (vaultState.maxSlippageBps / 100).toString();

  const swapTx = await getSwapTransaction({
    fromTokenAddress: leg.tokenIn,
    toTokenAddress: leg.tokenOut,
    amount: amountIn.toString(),
    userWalletAddress: vaultState.address, // the vault itself calls the router
    slippagePercent,
  });

  // The vault always calls its own stored `okxRouter`, not whatever address
  // this response says to call. If they've diverged, this calldata is not
  // safe to submit — bail loudly instead of silently sending it to the wrong
  // contract (or having the vault's call fail in a confusing way).
  if (swapTx.to.toLowerCase() !== vaultState.okxRouter.toLowerCase()) {
    throw new Error(
      `OKX router mismatch: API returned ${swapTx.to}, vault is configured for ${vaultState.okxRouter}. ` +
        `Do not submit this instruction — investigate before retrying.`
    );
  }

  return {
    tokenIn: leg.tokenIn,
    tokenOut: leg.tokenOut,
    amountIn,
    expectedAmountOut: BigInt(swapTx.toTokenAmount),
    minAmountOut: BigInt(swapTx.minReceiveAmount),
    targetAllocationBps: targetWeightsBps[leg.tokenOut] ?? 0,
    swapCalldata: swapTx.data,
  };
}
