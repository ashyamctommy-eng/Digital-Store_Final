/**
 * Currency model.
 *
 * USD is the single source of truth for every catalog price (`price_usd`).
 * KES is derived at display time using a fixed rate, so the two currencies can
 * never drift apart.
 */

/** 1 USD = 130 KES. Change here to re-price the whole store. */
export const FX_RATE_KES = 130;

export type Currency = "KES" | "USD";

export const CURRENCIES: Record<
  Currency,
  { code: Currency; symbol: string; flag: string; label: string }
> = {
  KES: { code: "KES", symbol: "KSh", flag: "🇰🇪", label: "Kenyan Shilling" },
  USD: { code: "USD", symbol: "$", flag: "🇺🇸", label: "US Dollar" },
};

export const LOCAL_CURRENCY: Currency = "KES";
export const INTERNATIONAL_CURRENCY: Currency = "USD";

/** Converts a base USD amount to whole KES shillings. */
export function toKES(usd: number): number {
  return Math.round((Number.isFinite(usd) ? usd : 0) * FX_RATE_KES);
}

/** Converts a KES amount back to USD (used for reporting). */
export function toUSD(kes: number): number {
  return Math.round(((Number.isFinite(kes) ? kes : 0) / FX_RATE_KES) * 100) / 100;
}

/**
 * Formats a base USD price in the active display currency.
 *   formatPrice(50, "KES") -> "KSh 6,500"
 *   formatPrice(50, "USD") -> "$50.00"
 */
export function formatPrice(usd: number, currency: Currency = "USD"): string {
  const value = Number.isFinite(usd) ? usd : 0;
  if (currency === "KES") {
    return `${CURRENCIES.KES.symbol} ${toKES(value).toLocaleString("en-KE")}`;
  }
  return `${CURRENCIES.USD.symbol}${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Formats a KES amount that has already been converted (e.g. an M-Pesa charge). */
export function formatKES(kes: number): string {
  return `${CURRENCIES.KES.symbol} ${Math.round(kes).toLocaleString("en-KE")}`;
}

/** Maps an ISO country code to the currency that country should see. */
export function currencyFromCountry(countryCode: string | null | undefined): Currency {
  return countryCode?.toUpperCase() === "KE"
    ? LOCAL_CURRENCY
    : INTERNATIONAL_CURRENCY;
}

/** Which gateway a currency is settled with. */
export type GatewayId = "palplus" | "nowpayments";

export interface Gateway {
  id: GatewayId;
  name: string;
  /** Short blurb shown in the checkout list. */
  description: string;
  /** Currencies this gateway can settle. */
  currencies: Currency[];
  /** Methods surfaced to the customer, e.g. "M-Pesa". */
  methods: string;
}

export const GATEWAYS: Record<GatewayId, Gateway> = {
  palplus: {
    id: "palplus",
    name: "M-Pesa (Palplus)",
    description: "Pay with M-Pesa STK push — approve on your phone.",
    currencies: ["KES"],
    methods: "M-Pesa",
  },
  nowpayments: {
    id: "nowpayments",
    name: "Crypto (NOWPayments)",
    description: "Pay in USDT, BTC, ETH and 300+ assets.",
    currencies: ["USD"],
    methods: "Crypto",
  },
};

/** The default gateway for a currency. */
export function gatewayForCurrency(currency: Currency): GatewayId {
  return currency === "KES" ? "palplus" : "nowpayments";
}
