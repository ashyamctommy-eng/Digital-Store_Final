"use client";

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firestore";
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
  orderRef: string;
  userId: string;
  userEmail: string;
  userName: string;
  items: CartItem[];
  totalAmount: number;
  currency: string;
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
  orderRef?: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  items?: CartItem[];
  totalAmount?: number;
  currency?: string;
  delivery?: Partial<DeliveryDetails>;
  paymentMethod?: string;
  paymentReference?: string;
  status?: OrderStatus;
  createdAt?: Date;
}

/** Saves an order to the `orders` collection. */
export async function saveOrder(order: Order): Promise<string> {
  const docRef = await addDoc(collection(db, "orders"), {
    ...order,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

/** All orders for a user, newest first. */
export async function getUserOrders(userId: string): Promise<OrderWithId[]> {
  const q = query(
    collection(db, "orders"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate() || new Date(),
    } as OrderWithId;
  });
}

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
