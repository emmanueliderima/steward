# Steward contracts

This workspace uses Node.js and npm independently from the Bun-based root
monorepo. Use Node.js 20 or newer.

## Install

From `apps/contracts`:

```sh
npm install --workspaces=false
```

The install-only flag keeps dependencies and `package-lock.json` scoped to
this directory while Bun continues to manage the root monorepo. Regular
`npm run` commands do not need that flag.

## Compile and test

```sh
npm run compile
npm test
```

Hardhat loads shared environment variables from the repository root `.env`.
An optional `apps/contracts/.env` file can override them for this package.

## Deploy

Deploy the self-contained mock fixture to X Layer testnet:

```sh
npm run deploy:test
```

Verify every saved testnet address and contract relationship without sending a
transaction:

```sh
npm run check:testnet
```

Fund the saved mock router with test tokens (100 mBTC, 1,000 mETH, and
100,000 mRWA by default):

```sh
npm run fund:testnet-router
```

The command is idempotent: it mints only the difference between each current
router balance and its target. Override targets when needed:

```env
ROUTER_MBTC_LIQUIDITY=100
ROUTER_METH_LIQUIDITY=1000
ROUTER_MRWA_LIQUIDITY=100000
```

The API and executor recognize the fixture's `mBTC`, `mETH`, and `mRWA`
symbols. Their default USD prices are 60000, 3000, and 100. Override them in
the root `.env` with `MOCK_MBTC_PRICE_USD`, `MOCK_METH_PRICE_USD`, and
`MOCK_MRWA_PRICE_USD`. The executor uses these fallbacks only when
`OKX_USE_MOCK_ROUTER=true`.

Deploy the production-shaped contracts using `scripts/deploy.ts`:

```sh
npm run deploy:testnet
npm run deploy:mainnet
```

The testnet RPC can be overridden without editing source:

```env
XLAYER_TESTNET_RPC_URL=https://your-x-layer-testnet-rpc.example
```
