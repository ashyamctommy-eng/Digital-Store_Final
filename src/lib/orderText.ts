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

/** Extra guidance shown for orders that include proxy addresses. */
export const PROXY_WARNINGS = [
  "ADD THE ADDRESSES TO YOUR PROXY TOOL ONE PER LINE",
  "THE POOL IS SHARED — AN ADDRESS MAY BE REASSIGNED LATER",
  "DO NOT SEND SENSITIVE LOGINS THROUGH AN UNVERIFIED ADDRESS",
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

      if (cred.kind === "proxy") {
        const proxies = cred.proxies ?? [];
        const auth = cred.proxy_auth ?? {};
        out.push(`Proxies (${proxies.length}):`);
        for (const address of proxies) {
          // Credentials inline: a proxy that needs auth is unusable without them.
          const inline = auth[address];
          out.push(`  ${inline ? `${inline}@${address}` : address}`);
        }
        if (cred.notes) out.push(`Notes:   ${cred.notes}`);
        out.push("");
        continue;
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

  if (credentials.some((c) => c.kind === "proxy")) {
    out.push("PROXIES");
    for (const warning of PROXY_WARNINGS) {
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

/**
 * All credentials as one copyable block.
 *
 * Proxies expand to their address list rather than a single UID line, so
 * pasting the whole order into a proxy tool still works.
 */
export function allCredentialsText(credentials: DeliveredCredential[]): string {
  return credentials
    .map((c) => {
      if (c.kind === "proxy") {
        const auth = c.proxy_auth ?? {};
        return (c.proxies ?? [])
          .map((address) => {
            const inline = auth[address];
            return inline ? `${inline}@${address}` : address;
          })
          .join("\n");
      }
      if (c.kind === "sms") {
        return c.phone_number ?? c.uid;
      }
      return `${c.uid} | ${c.account_data}`;
    })
    .filter((block) => block.trim() !== "")
    .join("\n");
}
