"use client";

import { readStore, useStore, writeStore } from "./browserStore";
import type { OrderStatus } from "./payments";

/**
 * Local order index.
 *
 * The storefront is a static export, so there is no server session to list
 * "my orders" from. Each checkout writes a small record here — including the
 * per-order token needed to read the credentials — and the Order History page
 * reads it back.
 *
 * This is the authoritative list for a guest buyer. Firestore still mirrors
 * orders for signed-in customers so history can follow them across devices.
 */
export interface LocalOrder {
  orderId: string;
  /** Per-order secret; required to fetch the credentials. */
  token: string;
  createdAt: string;
  status: OrderStatus;
  paymentMethod: string;
  currency: string;
  /** Amount in the currency the buyer paid in. */
  amount: number;
  amountUsd: number;
  buyerEmail: string;
  items: { product_id: string; name: string; quantity: number }[];
  /** Known only after a credentials fetch. */
  credentialCount?: number;
  shortfall?: Record<string, number>;
}

export const ORDERS_KEY = "dhs.orders.v1";
/** Module-level so the store snapshot stays referentially stable. */
const EMPTY: LocalOrder[] = [];

/** All orders, newest first. */
export function loadOrders(): LocalOrder[] {
  const list = readStore<LocalOrder[]>(ORDERS_KEY, EMPTY);
  return Array.isArray(list) ? list : EMPTY;
}

export function saveOrders(list: LocalOrder[]): void {
  writeStore(ORDERS_KEY, list);
}

/** Adds or replaces an order (keyed by orderId). */
export function upsertOrder(order: LocalOrder): void {
  const current = loadOrders();
  const next = current.some((o) => o.orderId === order.orderId)
    ? current.map((o) => (o.orderId === order.orderId ? { ...o, ...order } : o))
    : [order, ...current];
  saveOrders(next);
}

export function patchOrder(orderId: string, patch: Partial<LocalOrder>): void {
  saveOrders(
    loadOrders().map((o) => (o.orderId === orderId ? { ...o, ...patch } : o))
  );
}

/** Deletes one or many orders from the local index. */
export function deleteOrders(orderIds: string[]): void {
  const drop = new Set(orderIds);
  saveOrders(loadOrders().filter((o) => !drop.has(o.orderId)));
}

/** Subscribes a component to the order list. */
export function useOrders() {
  const [orders, setOrders] = useStore<LocalOrder[]>(ORDERS_KEY, EMPTY);

  return {
    orders: Array.isArray(orders) ? orders : EMPTY,
    setOrders,
    remove: (ids: string[]) => deleteOrders(ids),
    patch: (id: string, p: Partial<LocalOrder>) => patchOrder(id, p),
  };
}
