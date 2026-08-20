-- Steward indexer schema
-- Source of truth for balances/allocations is always the chain; this DB exists
-- to store what the chain can't cheaply hold: AI reasoning, confidence, and
-- time-series snapshots for the dashboard's charts.

create table vaults (
  address text primary key,
  owner_address text not null,
  created_at timestamptz not null default now(),
  min_rebalance_interval_seconds int not null,
  max_slippage_bps int not null
);

-- One row per asset the vault is allowed to hold, mirrors on-chain risk params.
-- Kept in sync by the indexer whenever RiskParamsUpdated fires.
create table vault_risk_params (
  vault_address text references vaults(address) on delete cascade,
  asset_address text not null,
  asset_symbol text not null,
  max_allocation_bps int not null,
  primary key (vault_address, asset_address)
);

-- One row per rebalance attempt, whether it succeeded, reverted, or the
-- executor decided no rebalance was needed. This is what "rebalance history"
-- on the dashboard reads from.
create table rebalance_events (
  id uuid primary key default gen_random_uuid(),
  vault_address text references vaults(address) on delete cascade,
  reasoning_id bytea not null,      -- matches the bytes32 emitted on-chain
  tx_hash text,                      -- null if the executor skipped or it reverted pre-submit
  outcome text not null check (outcome in ('executed', 'reverted', 'skipped_no_change')),
  revert_reason text,
  proposed_at timestamptz not null,
  executed_at timestamptz,
  ai_reasoning text not null,        -- full free-text explanation from the AI agent
  ai_confidence numeric(3,2) check (ai_confidence between 0 and 1), -- null for recovered rows
  recovered boolean not null default false, -- true if the indexer backfilled this from
                                             -- an on-chain event the executor never wrote
                                             -- (e.g. it crashed after the tx confirmed but
                                             -- before its own DB write) — reasoning/confidence
                                             -- are unavailable for these, by nature
  target_weights jsonb not null,     -- { asset_address: bps }
  market_snapshot jsonb not null     -- { prices, sentiment_score, sources_used }
);

create index on rebalance_events (vault_address, proposed_at desc);

-- Individual swap legs of an executed rebalance, for the per-asset breakdown.
create table rebalance_swaps (
  id uuid primary key default gen_random_uuid(),
  rebalance_event_id uuid references rebalance_events(id) on delete cascade,
  token_in text not null,
  token_out text not null,
  amount_in numeric not null,
  amount_out numeric not null
);

-- Tracks how far the indexer has scanned, per logical stream, so restarts
-- resume instead of re-scanning from genesis.
create table indexer_state (
  stream_key text primary key,
  last_processed_block bigint not null
);

-- Deposit/withdrawal history — the executor never sees these (they're direct
-- owner actions), only the indexer does, by watching Deposited/Withdrawn.
create table vault_transfers (
  id uuid primary key default gen_random_uuid(),
  vault_address text references vaults(address) on delete cascade,
  kind text not null check (kind in ('deposit', 'withdraw')),
  token_address text not null,
  amount numeric not null,
  tx_hash text not null,
  block_number bigint not null,
  occurred_at timestamptz not null default now()
);

create index on vault_transfers (vault_address, occurred_at desc);

-- Periodic snapshots (e.g. every hour) of vault value, used for the
-- 30-day-return calculation and any value-over-time chart.
create table vault_value_snapshots (
  vault_address text references vaults(address) on delete cascade,
  snapshot_at timestamptz not null,
  total_value_usd numeric not null,
  primary key (vault_address, snapshot_at)
);

create index on vault_value_snapshots (vault_address, snapshot_at desc);