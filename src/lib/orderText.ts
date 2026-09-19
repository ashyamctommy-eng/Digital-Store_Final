"use client";

import type { DeliveredCredential } from "./payments";
import type { LocalOrder } from "./orderStore";
import { BRAND } from "./config";

/** The usage warnings shown on the confirmation banner and in exports. */
export const USAGE_WARNINGS = [
  "SET VPN LOCATION IN USA WHEN LOGGING IN",
  "DO NOT CHANGE THE PASSWORD FOR 24 HOURS",
  "REPORT DEAD ACCOUNTS WITHIN 24 HOURS FOR REPLACEMENT",
] as const;

/** Extra guidance shown for orders that include an SMS number. */
export const SMS_WARNINGS = [
  "REQUEST THE CODE WITHIN A FEW MINUTES OF GETTING THE NUMBER",
  "USE A VPN IN THE NUMBER'S COUNTRY OR THE SERVICE MAY REJECT IT",
  "KEEP THE INBOX PAGE OPEN WHILE YOU WAIT FOR THE CODE",
] as const;

/**
 * Builds the downloadable `.txt` for an order.
 *
 * Mirrors the server-side renderer in `server/api/lib/dispatch.php`, so an
 * export taken from the browser matches one produced by the backend.
 */
export function buildOrderText(
  order: LocalOrder,
  credentials: DeliveredCredential[]
): string {
  const line = "=".repeat(46);
  const out: string[] = [];

  out.push(line);
  out.push(`  ${BRAND.fullName.toUpperCase()} — ORDER ${order.orderId}`);
  out.push(line);
  out.push("");

  const created = new Date(order.createdAt);
  if (!Number.isNaN(created.getTime())) {
    out.push(`Date:    ${created.toISOString()}`);
  }
  out.push(`Email:   ${order.buyerEmail}`);
  out.push(`Paid:    ${order.currency} ${order.amount.toLocaleString()}`);
  out.push(`Method:  ${order.paymentMethod}`);
  out.push("");

  if (credentials.length === 0) {
    out.push("No credentials are attached to this order yet.");
    out.push("If you have already paid, they will appear here shortly.");
  } else {
    let current: string | null = null;
    for (const cred of credentials) {
      if (cred.product_name !== current) {
        out.push("-".repeat(46));
        out.push(cred.product_name);
        out.push("-".repeat(46));
        current = cred.product_name;
      }

      if (cred.kind === "sms") {
        out.push(`Number:  ${cred.phone_number ?? cred.uid}`);
        if (cred.inbox_url) out.push(`Inbox:   ${cred.inbox_url}`);
        if (cred.notes) out.push(`Notes:   ${cred.notes}`);
        if (cred.source) out.push(`Source:  ${cred.source === "dynamic" ? "on demand" : "pre-bought"}`);
        if (cred.code) out.push(`Code:    ${cred.code}`);
        out.push("");
        continue;
      }

      out.push(`${cred.uid} | ${cred.account_data}`);
    }
  }

  if (credentials.some((c) => c.kind === "sms")) {
    out.push("SMS NUMBERS");
    for (const warning of SMS_WARNINGS) {
      out.push(`- ${warning}`);
    }
    out.push("");
  }

  out.push("");
  out.push("IMPORTANT");
  for (const warning of USAGE_WARNINGS) {
    out.push(`- ${warning}`);
  }
  out.push("");
  out.push("Keep this file safe — it contains your credentials.");
  out.push("");

  return out.join("\n");
}

/** Triggers a client-side download of the order export. */
export function downloadOrderText(
  order: LocalOrder,
  credentials: DeliveredCredential[]
): void {
  const blob = new Blob([buildOrderText(order, credentials)], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${order.orderId}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies text, falling back when the Clipboard API is unavailable. */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
      return true;
    } catch {
      return false;
    }
  }
}

/** All credentials as one copyable block. */
export function allCredentialsText(credentials: DeliveredCredential[]): string {
  return credentials
    .map((c) => `${c.uid} | ${c.account_data}`)
    .join("\n");
}
