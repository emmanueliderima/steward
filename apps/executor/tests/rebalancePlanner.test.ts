import { describe, expect, it } from "bun:test";
import { ethers } from "ethers";

process.env.GEMINI_API_KEY ??= "test-key";
process.env.XLAYER_RPC_URL ??= "http://localhost:8545";
process.env.VAULT_FACTORY_ADDRESS ??= "0x0000000000000000000000000000000000000001";
process.env.EXECUTOR_PRIVATE_KEY ??= `0x${"1".repeat(64)}`;
process.env.DATABASE_URL ??= "postgres://localhost:5432/test";
process.env.OKX_USE_MOCK_ROUTER = "true";
process.env.MOCK_ROUTER_ADDRESS = "0x0000000000000000000000000000000000000002";

const { buildSwapInstruction } = await import("../src/rebalancePlanner");

describe("mock swap instruction", () => {
  it("builds local mock-router calldata without calling OKX", async () => {
    const tokenIn = "0x0000000000000000000000000000000000000011";
    const tokenOut = "0x0000000000000000000000000000000000000022";
    const instruction = await buildSwapInstruction(
      {
        address: "0x0000000000000000000000000000000000000033",
        owner: "0x0000000000000000000000000000000000000044",
        okxRouter: process.env.MOCK_ROUTER_ADDRESS!,
        allowedAssets: [tokenIn, tokenOut],
        maxAllocationBps: { [tokenIn]: 6000, [tokenOut]: 6000 },
        maxSlippageBps: 200,
        minRebalanceInterval: 3600,
        lastRebalanceTimestamp: 0,
        balances: { [tokenIn]: ethers.parseEther("1"), [tokenOut]: 0n },
        decimals: { [tokenIn]: 18, [tokenOut]: 18 },
        symbols: { [tokenIn]: "mBTC", [tokenOut]: "mRWA" },
      },
      { tokenIn, tokenOut, amountInUsd: 60_000 },
      { [tokenIn]: 60_000, [tokenOut]: 100 },
      { [tokenIn]: 4000, [tokenOut]: 6000 }
    );

    expect(instruction.amountIn).toBe(ethers.parseEther("1"));
    expect(instruction.expectedAmountOut).toBe(ethers.parseEther("600"));
    expect(instruction.minAmountOut).toBe(ethers.parseEther("588"));

    const mockRouter = new ethers.Interface([
      "function swap(address tokenIn,uint256 amountIn,address tokenOut,uint256 amountOut)",
    ]);
    const decoded = mockRouter.decodeFunctionData("swap", instruction.swapCalldata);
    expect(decoded[0]).toBe(tokenIn);
    expect(decoded[1]).toBe(ethers.parseEther("1"));
    expect(decoded[2]).toBe(tokenOut);
    expect(decoded[3]).toBe(ethers.parseEther("600"));
  });
});
