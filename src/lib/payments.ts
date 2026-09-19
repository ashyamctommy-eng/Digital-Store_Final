"use client";

import type { CartItem } from "@/context/CartContext";
import type { DeliveryDetails } from "./orders";
import { BRAND, SUPPORT } from "./config";
import { FX_RATE_KES, formatKES, type Currency, type GatewayId } from "./currency";

/**
 * Client-side payments layer.
 *
 * Every gateway call goes through our own `/api/*` endpoints — never straight
 * to the provider. Provider API keys are secrets and cannot live in a static
 * bundle. The endpoints are PHP, which is what cPanel hosting can actually run
 * (see server/api/ and README).
 */

/** Overridable so the API can live on a different host if needed. */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

/* ------------------------------------------------------------------ */
/* Order references                                                    */
/* ------------------------------------------------------------------ */

/**
 * Full, human-readable order id: `ORDER_<PRODUCT_ID>_<TIMESTAMP>`.
 *
 * Used for NOWPayments, our own order ledger, order history and support.
 */
export function buildOrderId(items: CartItem[]): string {
  const productPart =
    items.length === 1 ? items[0].id : `CART${items.length}`;
  const safeProduct = productPart.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  return `ORDER_${safeProduct}_${Date.now()}`;
}

/**
 * Compact reference for M-Pesa.
 *
 * Palplus/M-Pesa cap `accountReference` at **12 characters**, so the full
 * order id cannot be used there. This produces a 12-character reference that
 * is stored alongside the full order id in our ledger, which is how the two
 * are reconciled on the webhook.
 */
export function buildAccountReference(items: CartItem[]): string {
  const productPart = items.length === 1 ? items[0].id : "CART";
  // Two chars of product identity + 7 chars of time entropy.
  const tag = productPart.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
  const entropy = (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  )
    .toUpperCase()
    .slice(-7);
  return `DHS${tag}${entropy}`.slice(0, 12);
}

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

export type OrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "unknown";

export interface OrderStatusResponse {
  order_id: string;
  status: OrderStatus;
  gateway?: GatewayId;
  amount?: number;
  currency?: Currency;
  /** M-Pesa receipt (Palplus) or crypto tx hash (NOWPayments). */
  reference?: string;
  message?: string;
}

/** Shared shape returned by both server endpoints. */
interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

async function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      return {
        ok: false,
        error: json?.error ?? `Request failed (${res.status})`,
        errorCode: json?.errorCode,
      };
    }
    return { ok: true, data: json as T };
  } catch {
    return {
      ok: false,
      error:
        "Could not reach the payment service. Check your connection and try again.",
    };
  }
}

async function getJson<T>(path: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      return { ok: false, error: json?.error ?? `Request failed (${res.status})` };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "Could not reach the payment service." };
  }
}

/* ------------------------------------------------------------------ */
/* Palplus — M-Pesa STK push (KES)                                     */
/* ------------------------------------------------------------------ */

export interface PalplusInitiateRequest {
  /** Full order id — stored server-side and echoed back on status calls. */
  orderId: string;
  /** Cart lines, used to claim inventory once the payment settles. */
  items: OrderLine[];
  /** Where the credentials email is sent. */
  buyerEmail: string;
  /** 12-character M-Pesa account reference. */
  accountReference: string;
  /** Amount in whole KES. */
  amountKes: number;
  /** M-Pesa number, normalised to 254XXXXXXXXX. */
  phone: string;
  /** Short label shown on the customer's PIN prompt (max 13 chars). */
  transactionDesc: string;
}

export interface PalplusInitiateResponse {
  order_id: string;
  /** Secret the buyer needs to read their credentials later. */
  order_token: string;
  transaction_id: string;
  status: OrderStatus;
  message?: string;
}

/** One cart line, sent to the server so it can claim stock after payment. */
export interface OrderLine {
  product_id: string;
  name: string;
  quantity: number;
}

export function toOrderLines(items: CartItem[]): OrderLine[] {
  return items.map((i) => ({
    product_id: i.id,
    name: i.name,
    quantity: i.quantity,
  }));
}

/** Converts a base USD amount to the exact KES integer we will charge. */
export function kesAmountFor(priceUsd: number): number {
  return Math.round(priceUsd * FX_RATE_KES);
}

/**
 * Normalises a Kenyan number to 254XXXXXXXXX.
 * Palplus accepts 07…, 01…, +254… and 254…, but we send one canonical form.
 */
export function normalizeMpesaPhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  let normalized = "";
  if (/^254\d{9}$/.test(digits)) normalized = digits;
  else if (/^0\d{9}$/.test(digits)) normalized = `254${digits.slice(1)}`;
  else if (/^[17]\d{8}$/.test(digits)) normalized = `254${digits}`;
  return normalized || null;
}

export function isValidMpesaPhone(input: string): boolean {
  return normalizeMpesaPhone(input) !== null;
}

/** Starts an STK push. The customer approves it on their phone. */
export async function initiatePalplus(
  req: PalplusInitiateRequest
): Promise<ApiResult<PalplusInitiateResponse>> {
  return postJson<PalplusInitiateResponse>("/palplus/initiate", req);
}

/* ------------------------------------------------------------------ */
/* NOWPayments — crypto invoice (USD)                                  */
/* ------------------------------------------------------------------ */

export interface NowpaymentsInvoiceRequest {
  orderId: string;
  /** Cart lines, used to claim inventory once the payment settles. */
  items: OrderLine[];
  /** Where the credentials email is sent. */
  buyerEmail: string;
  /** Exact base USD amount. */
  priceUsd: number;
  description: string;
  /** Where NOWPayments sends the customer after paying / cancelling. */
  successUrl?: string;
  cancelUrl?: string;
}

export interface NowpaymentsInvoiceResponse {
  order_id: string;
  /** Secret the buyer needs to read their credentials later. */
  order_token: string;
  invoice_id: string;
  invoice_url: string;
  status: OrderStatus;
}

/** Creates a hosted crypto invoice and returns the checkout URL. */
export async function createNowpaymentsInvoice(
  req: NowpaymentsInvoiceRequest
): Promise<ApiResult<NowpaymentsInvoiceResponse>> {
  return postJson<NowpaymentsInvoiceResponse>("/nowpayments/create-invoice", req);
}

/* ------------------------------------------------------------------ */
/* Status polling (both gateways)                                      */
/* ------------------------------------------------------------------ */

/**
 * Polls our ledger for the order's current status.
 *
 * The frontend never talks to Palplus/NOWPayments directly, so the browser is
 * told only what the server has already verified with the provider.
 */
export async function fetchOrderStatus(
  orderId: string
): Promise<ApiResult<OrderStatusResponse>> {
  return getJson<OrderStatusResponse>(
    `/orders/status?order_id=${encodeURIComponent(orderId)}`
  );
}

export interface PollOptions {
  /** Total time to wait before giving up, in ms. */
  timeoutMs?: number;
  /** Delay between polls, in ms. */
  intervalMs?: number;
  onStatus?: (status: OrderStatus) => void;
  signal?: AbortSignal;
}

const TERMINAL: OrderStatus[] = ["paid", "failed", "cancelled", "expired"];

/**
 * Polls until the order reaches a terminal state or the timeout elapses.
 * M-Pesa prompts usually resolve inside 60 seconds.
 */
export async function pollUntilSettled(
  orderId: string,
  {
    timeoutMs = 120000,
    intervalMs = 3000,
    onStatus,
    signal,
  }: PollOptions = {}
): Promise<OrderStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  let last: OrderStatus = "pending";

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return { order_id: orderId, status: "unknown", message: "Cancelled" };
    }

    const res = await fetchOrderStatus(orderId);
    if (res.ok && res.data) {
      last = res.data.status;
      onStatus?.(last);
      if (TERMINAL.includes(last)) return res.data;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    order_id: orderId,
    status: last,
    message:
      last === "pending"
        ? "We have not received confirmation yet. If you completed the payment, it will appear in your orders shortly."
        : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Credentials                                                         */
/* ------------------------------------------------------------------ */

export interface DeliveredCredential {
  product_id: string;
  product_name: string;
  uid: string;
  /** Raw pasted line: UID|Password|Email */
  account_data: string;
}

export interface CredentialsResponse {
  order_id: string;
  status: OrderStatus;
  gateway?: GatewayId;
  currency?: Currency;
  amount?: number;
  buyer_email?: string;
  created_at?: string;
  delivered_at?: string;
  email_sent_at?: string;
  shortfall?: Record<string, number>;
  credentials: DeliveredCredential[];
  items?: OrderLine[];
}

/**
 * Fetches the credentials for a paid order.
 *
 * The order id alone is not enough — the per-order token issued at checkout is
 * what authorises the read, so a leaked order id cannot expose credentials.
 */
export async function fetchCredentials(
  orderId: string,
  token: string
): Promise<ApiResult<CredentialsResponse>> {
  return getJson<CredentialsResponse>(
    `/orders/credentials?order_id=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`
  );
}

/** Public stock counts (COUNT of available inventory units). */
export async function fetchStockCounts(): Promise<ApiResult<{
  counts: Record<string, number>;
  generated_at: string;
}>> {
  return getJson(`/inventory/counts`);
}

/* ------------------------------------------------------------------ */
/* WhatsApp fallback                                                   */
/* ------------------------------------------------------------------ */

/** Builds the plain-text order summary sent over WhatsApp. */
export function buildOrderSummary(
  orderId: string,
  items: CartItem[],
  totalUsd: number,
  details: DeliveryDetails,
  currency: Currency,
  amountLabel: string
): string {
  const lines = items
    .map((item, i) => `${i + 1}. ${item.name} x${item.quantity}`)
    .join("\n");

  return (
    `🛒 *NEW ORDER — ${BRAND.fullName}*\n` +
    `Ref: *${orderId}*\n\n` +
    `*Items*\n${lines}\n\n` +
    `*Total: ${amountLabel}*` +
    (currency === "KES" ? ` ($${totalUsd.toFixed(2)} USD)` : "") +
    `\n\n👤 *Delivery Details*\n` +
    `Name: ${details.fullName}\n` +
    `Email: ${details.email}\n` +
    `WhatsApp: ${details.whatsapp}\n` +
    `Country: ${details.country}\n` +
    `${details.notes ? `Notes: ${details.notes}\n` : ""}` +
    `\n---\nSent from ${BRAND.fullName}`
  );
}

/** Opens WhatsApp with the order summary pre-filled. */
export function checkoutViaWhatsApp(
  orderId: string,
  items: CartItem[],
  totalUsd: number,
  details: DeliveryDetails,
  currency: Currency
): void {
  const amountLabel =
    currency === "KES" ? formatKES(kesAmountFor(totalUsd)) : `$${totalUsd.toFixed(2)}`;
  const message = buildOrderSummary(
    orderId,
    items,
    totalUsd,
    details,
    currency,
    amountLabel
  );
  const safe = message.length > 1800 ? `${message.slice(0, 1800)}…` : message;
  window.open(
    `https://wa.me/${SUPPORT.whatsapp}?text=${encodeURIComponent(safe)}`,
    "_blank",
    "noopener,noreferrer"
  );
}

/** Small helper for gateway display names. */
export function gatewayLabel(id: GatewayId): string {
  return id === "palplus" ? "M-Pesa (Palplus)" : "Crypto (NOWPayments)";
}
