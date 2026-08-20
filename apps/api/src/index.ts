import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { buildDashboardSummary } from "./dashboard-summary";
import { getVaultsByOwner } from "./chain";
import * as db from "./db";

const app = new Hono();

app.use("*", cors({ origin: config.corsOrigin }));

app.get("/health", (c) => c.json({ ok: true }));

// Public chain coordinates needed by the browser to create a vault. Contract
// addresses and chain IDs are public; no RPC credentials or secrets are sent.
app.get("/config", (c) =>
  c.json({
    vaultFactoryAddress: config.vaultFactoryAddress,
    chainId: config.chainId,
  })
);

// Vaults owned by a given address — the dashboard's "which vault am I
// looking at" entry point once a wallet connects.
app.get("/vaults", async (c) => {
  const owner = c.req.query("owner");
  if (!owner) return c.json({ error: "owner query param is required" }, 400);
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return c.json({ error: "owner must be a valid EVM address" }, 400);
  }

  try {
    // Ownership lives on-chain. Reading the factory directly means a vault is
    // discoverable as soon as its creation transaction confirms, without
    // waiting for the indexer's next database sync.
    const vaults = await getVaultsByOwner(owner);
    return c.json({ vaults });
  } catch (err: any) {
    console.error(`Failed to read vaults for ${owner}:`, err);
    return c.json({ error: "Failed to read vaults from X Layer" }, 502);
  }
});

// Total value, last rebalance, 30d return, next trigger, asset breakdown —
// balances/prices are live from chain, everything history-derived is from
// Postgres. See dashboardSummary.ts for exactly which is which and why.
app.get("/vaults/:address/summary", async (c) => {
  const address = c.req.param("address");
  try {
    const summary = await buildDashboardSummary(address);
    return c.json(summary);
  } catch (err: any) {
    return c.json({ error: `Failed to build summary: ${err.message ?? err}` }, 500);
  }
});

// Current risk params, kept in sync by the indexer — used to prefill the
// settings page. The settings page itself writes changes directly to the
// contract from the user's wallet, not through this API.
app.get("/vaults/:address/risk-params", async (c) => {
  const address = c.req.param("address");
  const params = await db.getRiskParams(address);
  if (!params) return c.json({ error: "Vault not found or not yet indexed" }, 404);
  return c.json(params);
});

// Rebalance history with AI reasoning + confidence, for the history table.
// Includes recovered rows (see apps/indexer) — check the `recovered` flag
// before rendering aiReasoning/aiConfidence, since recovered rows won't have
// real values for either.
app.get("/vaults/:address/history", async (c) => {
  const address = c.req.param("address");
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const history = await db.getRebalanceHistory(address, limit);
  return c.json({ history });
});

app.get("/vaults/:address/transfers", async (c) => {
  const address = c.req.param("address");
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const transfers = await db.getTransferHistory(address, limit);
  return c.json({ transfers });
});

console.log(`Steward API starting on port 3001`);

export default {
  port: 3001,
  fetch: app.fetch,
};
