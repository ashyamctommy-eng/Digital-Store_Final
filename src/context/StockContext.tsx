"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { fetchStockCounts } from "@/lib/payments";
import type { Product } from "@/lib/products";

/**
 * Live stock, derived from COUNT(available inventory units) on the server.
 *
 * Only products the admin has actually stocked are returned. Anything absent
 * keeps its static catalog number, so turning inventory on can never blank the
 * shop — and if the API is unreachable the storefront still renders.
 */
interface StockContextType {
  /** Available units, or undefined when the product has no inventory rows. */
  availableFor: (product: Product) => number | undefined;
  /** Static catalog number overridden by live stock when known. */
  stockFor: (product: Product) => number;
  /**
   * True when an SMS product has no pre-bought stock but the on-demand
   * provider can still supply it, so it stays purchasable.
   */
  isDynamic: (product: Product) => boolean;
  /** Purchasable at all: in stock, or fulfilable on demand. */
  isAvailable: (product: Product) => boolean;
  /** True once a successful fetch has landed. */
  live: boolean;
  refresh: () => void;
  lastUpdated: string | null;
}

const StockContext = createContext<StockContextType | undefined>(undefined);

export function StockProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [dynamic, setDynamic] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchStockCounts()
      .then((res) => {
        if (cancelled || !res.ok || !res.data) return;
        setCounts(res.data.counts ?? {});
        // SMS products with no static stock that the provider can still supply.
        setDynamic(res.data.dynamic ?? []);
        setLastUpdated(res.data.generated_at ?? null);
        setLive(true);
      })
      .catch(() => {
        // Static catalog numbers remain in use.
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const availableFor = useCallback(
    (product: Product) =>
      Object.prototype.hasOwnProperty.call(counts, product.id)
        ? counts[product.id]
        : undefined,
    [counts]
  );

  const stockFor = useCallback(
    (product: Product) => {
      const liveCount = availableFor(product);
      return liveCount === undefined ? product.stock : liveCount;
    },
    [availableFor]
  );

  const isDynamic = useCallback(
    (product: Product) => dynamic.includes(product.id),
    [dynamic]
  );

  const isAvailable = useCallback(
    (product: Product) => stockFor(product) > 0 || isDynamic(product),
    [stockFor, isDynamic]
  );

  const value = useMemo(
    () => ({ availableFor, stockFor, isDynamic, isAvailable, live, refresh, lastUpdated }),
    [availableFor, stockFor, isDynamic, isAvailable, live, refresh, lastUpdated]
  );

  return <StockContext.Provider value={value}>{children}</StockContext.Provider>;
}

export function useStock() {
  const context = useContext(StockContext);
  if (!context) {
    throw new Error("useStock must be used within a StockProvider");
  }
  return context;
}
