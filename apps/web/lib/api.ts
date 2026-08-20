import type { DashboardSummary, RebalanceRecord, RiskParams } from "@steward/shared-types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  getConfig: () =>
    get<{ vaultFactoryAddress: string; chainId: number }>("/config"),
  getVaultsByOwner: (owner: string) => get<{ vaults: string[] }>(`/vaults?owner=${owner}`),
  getSummary: (vaultAddress: string) => get<DashboardSummary>(`/vaults/${vaultAddress}/summary`),
  getRiskParams: (vaultAddress: string) => get<RiskParams>(`/vaults/${vaultAddress}/risk-params`),
  getHistory: (vaultAddress: string, limit = 20) =>
    get<{ history: RebalanceRecord[] }>(`/vaults/${vaultAddress}/history?limit=${limit}`),
};
