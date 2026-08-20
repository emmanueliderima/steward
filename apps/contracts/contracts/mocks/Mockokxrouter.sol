// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Stands in for OKX's DEX aggregator router in tests. Real swap calldata
///         from the OKX API would target the real router; here we just pull
///         tokenIn from the caller (the Vault, which already approved us) and
///         send back a pre-agreed amount of tokenOut. Fund this contract with
///         tokenOut before running a test that swaps into it.
contract MockOKXRouter {
    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(msg.sender, amountOut);
    }
}
