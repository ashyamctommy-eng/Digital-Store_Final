/**
 * Maps a ledger record onto the shape the admin screens render.
 *
 * The wire format is snake_case with the amount in whichever currency the
 * customer was charged; the UI wants camelCase and one comparable USD figure.
 * Doing it in one place keeps the three admin screens from drifting apart.
 *
 * It lives in its own module rather than inside `orders.ts` because that file
 * is part of the storefront, and the admin screens should not pull in anything
 * the buyer-facing bundle does not need.
 */

import type { LedgerOrder } from "./adminApi";

export interface AdminOrderItem {
  product_id: string;
  name: string;
  quantity: number;
  /** Unit price at the time of sale. 0 for orders written before this was
   *  recorded, so the UI shows nothing rather than a wrong figure. */
  price_usd: number;
}

export interface AdminOrderView {
  /** Ledger key — what the status endpoint expects. */
  id: string;
  orderId: string;
  accountReference?: string;
  /** The buyer's credential-retrieval key, shown so support can hand it over. */
  orderToken?: string;
  status: string;
  gateway?: string;
  /** Charged amount, in the currency the customer paid. */
  displayAmount?: number;
  displayCurrency?: string;
  /** The same order expressed in USD, for totals that mix currencies. */
  amountUsd: number;
  buyerName?: string;
  buyerEmail?: string;
  phone?: string;
  items: AdminOrderItem[];
  deliverables: unknown[];
  shortfall: unknown[];
  failureReason?: string;
  mpesaReceipt?: string;
  createdAt?: string;
  deliveredAt?: string;
}

/** KES per USD. Mirrors FX_RATE_KES so mixed-currency totals are comparable. */
const FX_RATE_KES = 130;

export function toAdminOrderView(order: LedgerOrder): AdminOrderView {
  const amountUsd =
    typeof order.amount_usd === "number" && order.amount_usd > 0
      ? order.amount_usd
      : typeof order.amount_kes === "number"
        ? Math.round((order.amount_kes / FX_RATE_KES) * 100) / 100
        : 0;

  return {
    id: String(order.order_id ?? ""),
    orderId: String(order.order_id ?? ""),
    accountReference: order.account_reference,
    orderToken: order.order_token,
    status: String(order.status ?? "pending"),
    gateway: order.gateway,
    displayAmount:
      typeof order.amount_kes === "number"
        ? order.amount_kes
        : typeof order.amount_usd === "number"
          ? order.amount_usd
          : undefined,
    displayCurrency: order.currency ?? undefined,
    amountUsd,
    buyerName: order.buyer_name ?? undefined,
    buyerEmail: order.buyer_email ?? undefined,
    phone: order.phone ?? undefined,
    items: (order.items ?? []).map((i) => ({
      product_id: String(i.product_id ?? ""),
      name: String(i.name ?? i.product_id ?? ""),
      quantity: Number(i.quantity ?? 1),
      price_usd: Number(i.price_usd ?? 0),
    })),
    deliverables: Array.isArray(order.deliverables) ? order.deliverables : [],
    shortfall: Array.isArray(order.shortfall) ? order.shortfall : [],
    failureReason: order.failure_reason ?? undefined,
    mpesaReceipt: order.mpesa_receipt ?? undefined,
    createdAt: order.created_at,
    deliveredAt: order.delivered_at ?? undefined,
  };
}
