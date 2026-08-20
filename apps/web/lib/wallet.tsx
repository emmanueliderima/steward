"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { BrowserProvider } from "ethers";

interface WalletState {
  address: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  getSigner: () => Promise<ReturnType<BrowserProvider["getSigner"]>>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) {
      alert("No wallet found. Install an OKX Wallet or MetaMask-compatible extension.");
      return;
    }
    setConnecting(true);
    try {
      const provider = new BrowserProvider(eth);
      const accounts = await provider.send("eth_requestAccounts", []);
      setAddress(accounts[0]);
    } finally {
      setConnecting(false);
    }
  }, []);

  const getSigner = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("No wallet found");
    const provider = new BrowserProvider(eth);
    return provider.getSigner();
  }, []);

  // Reconnect silently if the wallet already granted access in a past session.
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    eth.request({ method: "eth_accounts" }).then((accounts: string[]) => {
      if (accounts.length > 0) setAddress(accounts[0]);
    });
    const handleAccountsChanged = (accounts: string[]) => setAddress(accounts[0] ?? null);
    eth.on?.("accountsChanged", handleAccountsChanged);
    return () => eth.removeListener?.("accountsChanged", handleAccountsChanged);
  }, []);

  return (
    <WalletContext.Provider value={{ address, connecting, connect, getSigner }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}