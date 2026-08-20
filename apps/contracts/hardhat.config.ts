import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";

// X Layer moved to an upgraded OP-Stack-based architecture in Aug 2025; the old
// "Testnet" (chain id 195) is deprecated. Current network params per OKX's own
// X Layer docs (web3.okx.com/xlayer/docs) as of mid-2026:
const XLAYER_MAINNET = {
  chainId: 196,
  url: "https://rpc.xlayer.tech",
};

const XLAYER_TESTNET = {
  // "Terigon" testnet — confirm this is still current against the official docs
  // before deploying; testnet endpoints are the most likely thing to have moved.
  chainId: 1952,
  url: "https://testrpc.xlayer.tech/terigon",
};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    xlayerTestnet: {
      url: XLAYER_TESTNET.url,
      chainId: XLAYER_TESTNET.chainId,
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
    },
    xlayerMainnet: {
      url: XLAYER_MAINNET.url,
      chainId: XLAYER_MAINNET.chainId,
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
    },
  },
  // Gas on X Layer is paid in OKB, not ETH — no config change needed here,
  // just make sure the deployer wallet is funded with testnet OKB before deploying.
  typechain: {
    outDir: "../../packages/contracts-sdk/src/typechain",
    target: "ethers-v6",
  },
};

export default config;