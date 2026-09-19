"use client";

import { CartItem } from "@/context/CartContext";
import type { DeliveryDetails } from "./orders";
import { BRAND, COMMERCE, SUPPORT } from "./config";

/** Human-readable order reference, e.g. DHS-8F3K2Q. */
export function generateOrderRef(): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `DHS-${random}`;
}

/** Builds the plain-text order summary shared by all manual channels. */
export function buildOrderSummary(
  ref: string,
  items: CartItem[],
  total: number,
  details: DeliveryDetails
): string {
  const lines = items
    .map(
      (item, i) =>
        `${i + 1}. ${item.name} x${item.quantity} — ${COMMERCE.symbol} ${(
          item.price * item.quantity
        ).toLocaleString()}`
    )
    .join("\n");

  return (
    `🛒 *NEW ORDER — ${BRAND.fullName}*\n` +
    `Ref: *${ref}*\n\n` +
    `*Items*\n${lines}\n\n` +
    `*Total: ${COMMERCE.symbol} ${total.toLocaleString()} ${COMMERCE.currency}*\n\n` +
    `👤 *Delivery Details*\n` +
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
  ref: string,
  items: CartItem[],
  total: number,
  details: DeliveryDetails
): void {
  const message = buildOrderSummary(ref, items, total, details);
  // wa.me caps out around 2000 characters in practice; trim defensively.
  const safe = message.length > 1800 ? message.slice(0, 1800) + "…" : message;
  window.open(
    `https://wa.me/${SUPPORT.whatsapp}?text=${encodeURIComponent(safe)}`,
    "_blank",
    "noopener,noreferrer"
  );
}

// ============================================================
// M-Pesa STK Push
// ============================================================
/**
 * NOTE: this runs entirely in the browser and therefore cannot keep a
 * consumer secret. On a static host the request is expected to fail, and we
 * fall back to a manual confirmation flow rather than pretending the charge
 * succeeded. Move this behind a backend (or a payment provider) to go live.
 */
const MPESA_CONFIG = {
  shortcode: process.env.NEXT_PUBLIC_MPESA_SHORTCODE ?? "",
  passkey: process.env.NEXT_PUBLIC_MPESA_PASSKEY ?? "",
  consumerKey: process.env.NEXT_PUBLIC_MPESA_CONSUMER_KEY ?? "",
  consumerSecret: process.env.NEXT_PUBLIC_MPESA_CONSUMER_SECRET ?? "",
  callbackUrl: process.env.NEXT_PUBLIC_MPESA_CALLBACK_URL ?? "",
  baseUrl: "https://api.safaricom.co.ke",
};

export const mpesaConfigured = Boolean(
  MPESA_CONFIG.consumerKey && MPESA_CONFIG.consumerSecret && MPESA_CONFIG.shortcode
);

export interface MpesaSTKRequest {
  /** Format: 254XXXXXXXXX */
  phone: string;
  amount: number;
  accountRef: string;
}

export interface MpesaResult {
  success: boolean;
  message: string;
  checkoutRequestId?: string;
  /** True when we could not reach M-Pesa and the user must confirm manually. */
  manual?: boolean;
}

export async function initiateMpesaSTKPush(
  request: MpesaSTKRequest
): Promise<MpesaResult> {
  if (!mpesaConfigured) {
    return {
      success: false,
      manual: true,
      message:
        "Card/M-Pesa is being set up for this store. Complete your order via WhatsApp and we will send the M-Pesa till details instantly.",
    };
  }

  try {
    const authString = btoa(
      `${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`
    );

    const tokenRes = await fetch(
      `${MPESA_CONFIG.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${authString}` } }
    );
    if (!tokenRes.ok) throw new Error("auth failed");

    const { access_token: accessToken } = await tokenRes.json();

    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:.Z]/g, "")
      .slice(0, 14);
    const password = btoa(
      `${MPESA_CONFIG.shortcode}${MPESA_CONFIG.passkey}${timestamp}`
    );

    const stkRes = await fetch(
      `${MPESA_CONFIG.baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          BusinessShortCode: MPESA_CONFIG.shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: "CustomerPayBillOnline",
          Amount: Math.ceil(request.amount),
          PartyA: request.phone,
          PartyB: MPESA_CONFIG.shortcode,
          PhoneNumber: request.phone,
          CallBackURL: MPESA_CONFIG.callbackUrl,
          AccountReference: request.accountRef,
          TransactionDesc: `Payment for ${request.accountRef}`,
        }),
      }
    );

    if (!stkRes.ok) throw new Error("stk failed");

    const data = await stkRes.json();
    if (data.ResponseCode === "0") {
      return {
        success: true,
        checkoutRequestId: data.CheckoutRequestID,
        message: `Payment request sent to ${request.phone}. Enter your M-Pesa PIN to complete the order.`,
      };
    }

    return {
      success: false,
      message: data.ResponseDescription || "M-Pesa request was declined.",
    };
  } catch {
    return {
      success: false,
      manual: true,
      message:
        "We could not reach M-Pesa right now. Finish via WhatsApp and we will send payment details immediately.",
    };
  }
}

/** Normalises a Kenyan number to the 254XXXXXXXXX form M-Pesa expects. */
export function formatPhoneForMpesa(phone: string): string {
  const cleaned = phone.replace(/[\s\-+()]/g, "");
  if (cleaned.startsWith("254")) return cleaned;
  if (cleaned.startsWith("0")) return `254${cleaned.slice(1)}`;
  return `254${cleaned}`;
}
