"use client";

import { CartItem } from "@/context/CartContext";

/**
 * Details collected at checkout. Digital goods are delivered to an email /
 * chat handle, so there is no shipping address any more.
 */
export interface DeliveryDetails {
  fullName: string;
  email: string;
  /** WhatsApp number used to hand over credentials instantly. */
  whatsapp: string;
  /** Country helps us route the right regional stock. */
  country: string;
  notes: string;
}

export type OrderStatus =
  | "pending"
  | "paid"
  | "delivered"
  | "failed"
  | "refunded";

export const ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "paid",
  "delivered",
  "failed",
  "refunded",
];

export interface Order {
  /** Full human-readable id: ORDER_<PRODUCT_ID>_<TIMESTAMP>. */
  orderId: string;
  /** 12-character M-Pesa reference (Palplus accountReference). */
  accountReference?: string;
  userId: string;
  userEmail: string;
  userName: string;
  items: CartItem[];
  /** Order total in base USD. */
  amountUsd: number;
  /** Currency the customer actually paid in. */
  displayCurrency?: string;
  /** Amount charged in that display currency (KES integer, or USD). */
  displayAmount?: number;
  delivery: DeliveryDetails;
  paymentMethod: string;
  paymentReference: string;
  status: OrderStatus;
  createdAt?: unknown;
}

export interface OrderWithId extends Order {
  id: string;
  createdAt: Date;
}

/**
 * A document as it comes back from Firestore. Fields are optional because
 * documents written by older builds (or by hand) may not match `Order`.
 */
export interface StoredOrder {
  id: string;
  orderId?: string;
  accountReference?: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  items?: CartItem[];
  amountUsd?: number;
  displayCurrency?: string;
  displayAmount?: number;
  delivery?: Partial<DeliveryDetails>;
  paymentMethod?: string;
  paymentReference?: string;
  status?: OrderStatus;
  createdAt?: Date;
}

/*
 * Orders are NOT written to Firestore any more.
 *
 * There used to be a browser-side mirror written at checkout (`saveOrder`) and a
 * matching per-user read (`getUserOrders`). That made the browser a source of
 * order records: the admin console listed those documents rather than the ledger
 * the payment webhooks wrote, so the two could disagree and a buyer could forge
 * a row. The PHP ledger (server/api/lib/store.php) is now the only order store,
 * and admin screens read it through /api/admin/orders.
 *
 * Buyer-side history still works: each order's retrieval token is kept in this
 * browser (see lib/orderStore.ts), which is what the account page and the order
 * details modal use.
 */

/** Extracts a Firebase error code from an unknown thrown value. */
export function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code?: unknown }).code ?? "");
  }
  return "";
}

/** Extracts a readable message from an unknown thrown value. */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}
