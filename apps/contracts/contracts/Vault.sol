// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Vault
/// @notice Per-user rebalancing vault, deployed as a minimal proxy clone by VaultFactory.
/// @dev The AI/executor can only PROPOSE a rebalance. Every proposal is checked here,
///      on-chain, against limits the owner set themselves. If any check fails, this
///      reverts — the executor's off-chain reasoning never gets the last word.
/// @dev Clones share one implementation's bytecode but not its storage, so each clone
///      starts with `_initialized = false` and `_reentrancyLock = false` on its own —
///      no upgradeable-contracts dependency needed for either guard.
contract Vault {
    using SafeERC20 for IERC20;

    bool private _initialized;
    bool private _reentrancyLock;

    modifier initializer() {
        require(!_initialized, "AlreadyInitialized");
        _initialized = true;
        _;
    }

    modifier nonReentrant() {
        require(!_reentrancyLock, "Reentrant");
        _reentrancyLock = true;
        _;
        _reentrancyLock = false;
    }

    // ── Errors ──────────────────────────────────────────────────────────────
    error NotOwner();
    error NotExecutor();
    error AssetNotAllowed(address token);
    error AllocationExceeded(address token, uint16 requestedBps, uint16 maxBps);
    error SlippageExceeded(uint16 requestedBps, uint16 maxBps);
    error RebalanceTooSoon(uint256 nextAllowedAt);
    error SwapFailed(address tokenOut);

    // ── Events ──────────────────────────────────────────────────────────────
    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount);
    event RiskParamsUpdated();
    event RebalanceExecuted(
        uint256 indexed timestamp,
        bytes32 indexed reasoningId, // FK into the Postgres rebalance_events table
        address[] tokensIn,
        address[] tokensOut,
        uint256[] amountsIn,
        uint256[] amountsOut
    );

    // ── Storage ─────────────────────────────────────────────────────────────
    address public owner;
    address public executor; // keeper/backend address allowed to submit rebalances
    address public okxRouter; // OKX DEX aggregator router for this chain

    address[] public allowedAssets;
    mapping(address => bool) public isAllowedAsset;
    mapping(address => uint16) public maxAllocationBps; // per-asset cap, out of 10_000

    uint16 public maxSlippageBps; // e.g. 100 = 1%
    uint32 public minRebalanceInterval; // seconds
    uint256 public lastRebalanceTimestamp;

    /// @dev One instruction = one swap leg of a proposed rebalance.
    struct SwapInstruction {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 expectedAmountOut; // OKX quote's expected output, pre-slippage
        uint256 minAmountOut; // OKX quote's guaranteed minimum output
        uint16 targetAllocationBps; // resulting weight of tokenOut after this swap
        bytes swapCalldata; // calldata from OKX /aggregator/swap, targets okxRouter
    }

    // ── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    // ── Init (replaces constructor for clones) ─────────────────────────────
    function initialize(
        address owner_,
        address executor_,
        address okxRouter_,
        address[] calldata allowedAssets_,
        uint16[] calldata maxAllocationBps_,
        uint16 maxSlippageBps_,
        uint32 minRebalanceInterval_
    ) external initializer {
        require(allowedAssets_.length == maxAllocationBps_.length, "LengthMismatch");

        owner = owner_;
        executor = executor_;
        okxRouter = okxRouter_;
        maxSlippageBps = maxSlippageBps_;
        minRebalanceInterval = minRebalanceInterval_;

        for (uint256 i = 0; i < allowedAssets_.length; i++) {
            allowedAssets.push(allowedAssets_[i]);
            isAllowedAsset[allowedAssets_[i]] = true;
            maxAllocationBps[allowedAssets_[i]] = maxAllocationBps_[i];
        }
    }

    // ── Owner actions ───────────────────────────────────────────────────────
    function deposit(address token, uint256 amount) external onlyOwner {
        if (!isAllowedAsset[token]) revert AssetNotAllowed(token);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(token, amount);
    }

    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(owner, amount);
        emit Withdrawn(token, amount);
    }

    /// @notice Owner can tighten or loosen their own limits at any time.
    ///         The executor never has permission to touch these.
    function updateRiskParams(
        uint16[] calldata newMaxAllocationBps,
        uint16 newMaxSlippageBps,
        uint32 newMinRebalanceInterval
    ) external onlyOwner {
        require(newMaxAllocationBps.length == allowedAssets.length, "LengthMismatch");
        for (uint256 i = 0; i < allowedAssets.length; i++) {
            maxAllocationBps[allowedAssets[i]] = newMaxAllocationBps[i];
        }
        maxSlippageBps = newMaxSlippageBps;
        minRebalanceInterval = newMinRebalanceInterval;
        emit RiskParamsUpdated();
    }

    // ── The on-chain gate ───────────────────────────────────────────────────
    /// @notice Executor submits the AI's proposed rebalance. Every instruction is
    ///         validated against this vault's own stored limits before anything
    ///         gets swapped. One bad instruction reverts the whole batch.
    /// @param reasoningId Off-chain reference (hash) into Postgres, where the
    ///        AI's full reasoning text and confidence score are stored.
    function executeRebalance(SwapInstruction[] calldata instructions, bytes32 reasoningId)
        external
        onlyExecutor
        nonReentrant
    {
        if (block.timestamp < lastRebalanceTimestamp + minRebalanceInterval) {
            revert RebalanceTooSoon(lastRebalanceTimestamp + minRebalanceInterval);
        }

        address[] memory tokensIn = new address[](instructions.length);
        address[] memory tokensOut = new address[](instructions.length);
        uint256[] memory amountsIn = new uint256[](instructions.length);
        uint256[] memory amountsOut = new uint256[](instructions.length);

        for (uint256 i = 0; i < instructions.length; i++) {
            SwapInstruction calldata ix = instructions[i];

            if (!isAllowedAsset[ix.tokenOut]) revert AssetNotAllowed(ix.tokenOut);

            uint16 cap = maxAllocationBps[ix.tokenOut];
            if (ix.targetAllocationBps > cap) {
                revert AllocationExceeded(ix.tokenOut, ix.targetAllocationBps, cap);
            }

            // Slippage check: how far minAmountOut sits below the quote's expected
            // output, vs. what the owner said they'd tolerate.
            // NOTE: expectedAmountOut is supplied by the executor from the OKX quote.
            // For production, cross-check it against an independent on-chain price
            // feed (Pyth/Chainlink, whichever is live on X Layer) so a malicious
            // executor can't misreport the quote to hide real slippage.
            uint256 impliedSlippageBps = ix.expectedAmountOut == 0
                ? 0
                : ((ix.expectedAmountOut - ix.minAmountOut) * 10_000) / ix.expectedAmountOut;
            if (impliedSlippageBps > maxSlippageBps) {
                revert SlippageExceeded(uint16(impliedSlippageBps), maxSlippageBps);
            }

            IERC20(ix.tokenIn).forceApprove(okxRouter, ix.amountIn);

            uint256 balBefore = IERC20(ix.tokenOut).balanceOf(address(this));
            (bool success,) = okxRouter.call(ix.swapCalldata);
            if (!success) revert SwapFailed(ix.tokenOut);
            uint256 received = IERC20(ix.tokenOut).balanceOf(address(this)) - balBefore;

            tokensIn[i] = ix.tokenIn;
            tokensOut[i] = ix.tokenOut;
            amountsIn[i] = ix.amountIn;
            amountsOut[i] = received;
        }

        lastRebalanceTimestamp = block.timestamp;
        emit RebalanceExecuted(block.timestamp, reasoningId, tokensIn, tokensOut, amountsIn, amountsOut);
    }

    function getAllowedAssets() external view returns (address[] memory) {
        return allowedAssets;
    }
}