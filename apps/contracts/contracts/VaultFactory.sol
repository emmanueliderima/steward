// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Vault} from "./Vault.sol";

/// @title VaultFactory
/// @notice Deploys per-user Vault clones (EIP-1167 minimal proxies) so each user gets
///         an isolated contract without the gas cost of a full deployment.
contract VaultFactory is Ownable {
    address public immutable vaultImplementation;
    address public okxRouter;
    address public immutable defaultExecutor; // Steward's keeper address

    mapping(address => address[]) public vaultsByOwner;
    address[] public allVaults;

    event VaultCreated(address indexed owner, address indexed vault);
    event DefaultOkxRouterUpdated(address indexed previousRouter, address indexed newRouter);

    error InvalidRouter(address router);
    error RouterUnchanged();

    constructor(address vaultImplementation_, address okxRouter_, address defaultExecutor_)
        Ownable(msg.sender)
    {
        if (okxRouter_ == address(0) || okxRouter_.code.length == 0) {
            revert InvalidRouter(okxRouter_);
        }
        vaultImplementation = vaultImplementation_;
        okxRouter = okxRouter_;
        defaultExecutor = defaultExecutor_;
    }

    /// @notice Changes the router assigned to vaults created from now on.
    /// @dev Existing vaults remain isolated and must be updated by their owners.
    function updateDefaultOkxRouter(address newRouter) external onlyOwner {
        if (newRouter == address(0) || newRouter.code.length == 0) {
            revert InvalidRouter(newRouter);
        }
        address previousRouter = okxRouter;
        if (newRouter == previousRouter) revert RouterUnchanged();

        okxRouter = newRouter;
        emit DefaultOkxRouterUpdated(previousRouter, newRouter);
    }

    function createVault(
        address[] calldata allowedAssets,
        uint16[] calldata maxAllocationBps,
        uint16 maxSlippageBps,
        uint32 minRebalanceInterval
    ) external returns (address vault) {
        vault = Clones.clone(vaultImplementation);

        Vault(vault).initialize(
            msg.sender,
            defaultExecutor,
            okxRouter,
            allowedAssets,
            maxAllocationBps,
            maxSlippageBps,
            minRebalanceInterval
        );

        vaultsByOwner[msg.sender].push(vault);
        allVaults.push(vault);

        emit VaultCreated(msg.sender, vault);
    }

    function getVaultsByOwner(address user) external view returns (address[] memory) {
        return vaultsByOwner[user];
    }

    function totalVaults() external view returns (uint256) {
        return allVaults.length;
    }
}
