"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { BrowserProvider } from "ethers";

interface WalletState {
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  connect: () => Promise<void>;
  ensureExpectedChain: (chainId?: number) => Promise<void>;
  getSigner: () => ReturnType<BrowserProvider["getSigner"]>;
}

const WalletContext = createContext<WalletState | null>(null);

// `any` avoids a false incompatibility between the React type copies pulled in
// by Next and the generated contracts workspace package.
export function WalletProvider({ children }: { children: any }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);

  const expectedChainId = Number(process.env.NEXT_PUBLIC_XLAYER_CHAIN_ID ?? 196);

  const refreshChainId = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    const value = await eth.request({ method: "eth_chainId" });
    setChainId(Number.parseInt(value, 16));
  }, []);

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
      await refreshChainId();
    } finally {
      setConnecting(false);
    }
  }, [refreshChainId]);

  const ensureExpectedChain = useCallback(async (requestedChainId?: number) => {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("No wallet found");

    const targetChainId = requestedChainId ?? expectedChainId;

    const current = Number.parseInt(await eth.request({ method: "eth_chainId" }), 16);
    if (current === targetChainId) {
      setChainId(current);
      return;
    }

    const chainIdHex = `0x${targetChainId.toString(16)}`;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch (err: any) {
      if (err.code !== 4902) throw err;

      const isMainnet = targetChainId === 196;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: isMainnet ? "X Layer Mainnet" : "X Layer Testnet",
            nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
            rpcUrls: [
              process.env.NEXT_PUBLIC_XLAYER_RPC_URL ??
                (isMainnet
                  ? "https://rpc.xlayer.tech"
                  : "https://testrpc.xlayer.tech/terigon"),
            ],
            blockExplorerUrls: isMainnet ? ["https://www.oklink.com/xlayer"] : undefined,
          },
        ],
      });
    }
    setChainId(targetChainId);
  }, [expectedChainId]);

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
    refreshChainId().catch(() => undefined);
    const handleAccountsChanged = (accounts: string[]) => setAddress(accounts[0] ?? null);
    const handleChainChanged = (value: string) => setChainId(Number.parseInt(value, 16));
    eth.on?.("accountsChanged", handleAccountsChanged);
    eth.on?.("chainChanged", handleChainChanged);
    return () => {
      eth.removeListener?.("accountsChanged", handleAccountsChanged);
      eth.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [refreshChainId]);

  return (
    <WalletContext.Provider
      value={{ address, chainId, connecting, connect, ensureExpectedChain, getSigner }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
