// Hand-written ABI fragments for just the functions the executor calls.
// Once you run `hardhat compile`, you can switch these out for the generated
// Typechain types in packages/contracts-sdk for full type safety — this
// exists so the executor doesn't have a hard dependency on that build step.

export const vaultFactoryAbi = [
  "function totalVaults() view returns (uint256)",
  "function allVaults(uint256) view returns (address)",
  "function getVaultsByOwner(address owner) view returns (address[])",
  "event VaultCreated(address indexed owner, address indexed vault)",
];

export const vaultAbi = [
  "function owner() view returns (address)",
  "function executor() view returns (address)",
  "function okxRouter() view returns (address)",
  "function maxSlippageBps() view returns (uint16)",
  "function minRebalanceInterval() view returns (uint32)",
  "function lastRebalanceTimestamp() view returns (uint256)",
  "function isAllowedAsset(address) view returns (bool)",
  "function maxAllocationBps(address) view returns (uint16)",
  "function getAllowedAssets() view returns (address[])",
  "function executeRebalance((address tokenIn, address tokenOut, uint256 amountIn, uint256 expectedAmountOut, uint256 minAmountOut, uint16 targetAllocationBps, bytes swapCalldata)[] instructions, bytes32 reasoningId)",
  "event RebalanceExecuted(uint256 indexed timestamp, bytes32 indexed reasoningId, address[] tokensIn, address[] tokensOut, uint256[] amountsIn, uint256[] amountsOut)",
];

export const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];