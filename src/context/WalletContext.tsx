"use client";

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { readStore, useStore, writeStore } from "@/lib/browserStore";

/**
 * Wallet balance.
 *
 * This build keeps the balance in localStorage so the storefront works on a
 * static host with no backend. Swapping in a real ledger (Firestore
 * `wallets/{uid}` or a payment provider) means replacing the read/write calls
 * below — the public API stays identical.
 */
interface WalletState {
  balance: number;
  /** True once the customer has ever funded the wallet. */
  hasFunded: boolean;
}

interface WalletContextType extends WalletState {
  /** Adds funds. Only call after a payment has actually been confirmed. */
  credit: (amount: number) => void;
  /** Removes funds. Returns false when the balance is insufficient. */
  debit: (amount: number) => boolean;
  canAfford: (amount: number) => boolean;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const WALLET_KEY = "dhs.wallet.v1";
/** Module-level so the snapshot reference stays stable across renders. */
const EMPTY_WALLET: WalletState = { balance: 0, hasFunded: false };

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useStore<WalletState>(WALLET_KEY, EMPTY_WALLET);

  const credit = useCallback(
    (amount: number) => {
      if (!Number.isFinite(amount) || amount <= 0) return;
      const current = readStore<WalletState>(WALLET_KEY, EMPTY_WALLET);
      setWallet({
        balance: Math.round((current.balance + amount) * 100) / 100,
        hasFunded: true,
      });
    },
    [setWallet]
  );

  const debit = useCallback(
    (amount: number): boolean => {
      if (!Number.isFinite(amount) || amount <= 0) return false;
      const current = readStore<WalletState>(WALLET_KEY, EMPTY_WALLET);
      if (current.balance < amount) return false;
      writeStore(WALLET_KEY, {
        balance: Math.round((current.balance - amount) * 100) / 100,
        hasFunded: current.hasFunded,
      });
      return true;
    },
    []
  );

  const canAfford = useCallback(
    (amount: number) => wallet.balance >= amount,
    [wallet.balance]
  );

  const value = useMemo(
    () => ({
      balance: wallet.balance,
      hasFunded: wallet.hasFunded,
      credit,
      debit,
      canAfford,
    }),
    [wallet.balance, wallet.hasFunded, credit, debit, canAfford]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
