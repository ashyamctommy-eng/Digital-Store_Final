"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import {
  CURRENCIES,
  currencyFromCountry,
  formatPrice,
  gatewayForCurrency,
  INTERNATIONAL_CURRENCY,
  type Currency,
  type GatewayId,
} from "@/lib/currency";
import { useStore } from "@/lib/browserStore";

const CURRENCY_KEY = "dhs.currency";
const GEO_KEY = "dhs.geo";
/** Module-level defaults keep the store snapshots referentially stable. */
const NO_OVERRIDE = "" as const;

export type CurrencySource = "manual" | "auto" | "pending";

interface GeoResult {
  country: string | null;
  currency: Currency;
}

interface CurrencyContextType {
  currency: Currency;
  /** How the active currency was chosen. */
  source: CurrencySource;
  /** Country detected by IP, when available. */
  country: string | null;
  /** True while the IP lookup is still running. */
  detecting: boolean;
  /** Overrides detection and persists the choice. */
  setCurrency: (currency: Currency) => void;
  /** Drops the manual override and re-runs detection. */
  reDetect: () => void;
  /** Formats a base-USD price in the active currency. */
  format: (usd: number) => string;
  /** The gateway the active currency settles with. */
  gateway: GatewayId;
  symbol: string;
  flag: string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

interface IpApiResponse {
  country_code?: string;
  country_name?: string;
  error?: boolean;
}

/**
 * Resolves the visitor's currency.
 *
 * Order of precedence:
 *   1. A manual choice saved in localStorage (always wins).
 *   2. IP geolocation via ipapi.co.
 *   3. Fallback: USD (the international default).
 *
 * A failed or rate-limited lookup deliberately is NOT persisted, so a transient
 * network problem cannot permanently pin a Kenyan visitor to USD.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useStore<string>(CURRENCY_KEY, NO_OVERRIDE);
  const [geo, setGeo] = useStore<GeoResult | null>(GEO_KEY, null);
  const [attempted, setAttempted] = useState(false);

  const hasOverride = override === "KES" || override === "USD";

  useEffect(() => {
    // Nothing to do when the visitor has chosen, we already know, or we have
    // already tried once this session.
    if (hasOverride || geo || attempted) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    fetch("https://ipapi.co/json/", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("geo failed"))))
      .then((data: IpApiResponse) => {
        if (cancelled || data?.error) return;
        // Only persist a genuine detection.
        setGeo({
          country: data.country_code ?? null,
          currency: currencyFromCountry(data.country_code),
        });
      })
      .catch(() => {
        // Offline, blocked or rate-limited: fall back to USD for this session.
      })
      .finally(() => {
        if (!cancelled) setAttempted(true);
        clearTimeout(timeout);
      });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [hasOverride, geo, attempted, setGeo]);

  const setCurrency = useCallback(
    (next: Currency) => setOverride(next),
    [setOverride]
  );

  const reDetect = useCallback(() => {
    setOverride(NO_OVERRIDE);
    setGeo(null);
    setAttempted(false);
  }, [setOverride, setGeo]);

  const currency: Currency = hasOverride
    ? (override as Currency)
    : (geo?.currency ?? INTERNATIONAL_CURRENCY);

  const source: CurrencySource = hasOverride ? "manual" : geo ? "auto" : "pending";

  // Still resolving only while we have neither a choice nor a result and the
  // first lookup has not finished.
  const detecting = !hasOverride && !geo && !attempted;

  const format = useCallback((usd: number) => formatPrice(usd, currency), [currency]);

  const value = useMemo<CurrencyContextType>(
    () => ({
      currency,
      source,
      country: geo?.country ?? null,
      detecting,
      setCurrency,
      reDetect,
      format,
      gateway: gatewayForCurrency(currency),
      symbol: CURRENCIES[currency].symbol,
      flag: CURRENCIES[currency].flag,
    }),
    [
      currency,
      source,
      geo,
      detecting,
      setCurrency,
      reDetect,
      format,
    ]
  );

  return (
    <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}
