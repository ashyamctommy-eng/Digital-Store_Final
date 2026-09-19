"use client";

import { API_BASE } from "./payments";

/**
 * Admin API client.
 *
 * The admin endpoints are protected by a shared key held in `config.php` on the
 * server. It is entered once and kept in sessionStorage — never bundled, never
 * in localStorage, and gone when the tab closes.
 *
 * This is a shared secret rather than per-user auth; see server/api/README.md
 * for the Firebase-token upgrade path.
 */
const ADMIN_KEY_STORAGE = "dhs.adminKey";

export function getAdminKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setAdminKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
    else sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    // Session storage unavailable — the caller still gets an error from the API.
  }
}

export function clearAdminKey(): void {
  setAdminKey("");
}

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  status?: number;
}

async function adminFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  const key = getAdminKey();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": key,
        ...(init.headers ?? {}),
      },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error ?? `Request failed (${res.status})`,
        errorCode: json?.errorCode,
      };
    }
    return { ok: true, status: res.status, data: json as T };
  } catch {
    return { ok: false, error: "Could not reach the payment API." };
  }
}

/* ------------------------------- inventory ------------------------------ */

export interface InventoryAddResponse {
  product_id: string;
  added: number;
  duplicates: number;
  available: number;
  needs_review: string[];
}

export interface InventoryDryRunResponse {
  product_id: string;
  dry_run: true;
  parsed: number;
  preview: { uid: string; secret: string }[];
  needs_review: string[];
}

export interface InventoryListResponse {
  products: {
    product_id: string;
    available: number;
    sold: number;
    total: number;
    sample: { uid: string; secret: string }[];
    updated_at: string | null;
  }[];
  totals: { products: number; available: number; sold: number };
}

export function adminAddStock(
  productId: string,
  text: string,
  dryRun = false
): Promise<ApiResult<InventoryAddResponse | InventoryDryRunResponse>> {
  return adminFetch("/admin/inventory/add", {
    method: "POST",
    body: JSON.stringify({ productId, text, dryRun }),
  });
}

export function adminListStock(): Promise<ApiResult<InventoryListResponse>> {
  return adminFetch("/admin/inventory/list", { method: "GET" });
}

export interface SmsotpStatusResponse {
  configured: boolean;
  balance: number;
  balance_ok: boolean;
  balance_error: string | null;
  min_balance: number;
  api_base: string;
  sms_products: number;
  services: { id: string; name: string }[];
  /** Catalog service codes the provider does not recognise. */
  missing_service_ids: Record<string, string>;
}

/** On-demand SMS provider status, for the stock console. */
export function adminSmsotpStatus(): Promise<ApiResult<SmsotpStatusResponse>> {
  return adminFetch("/admin/smsotp-status", { method: "GET" });
}

/* ------------------------------- nextproxy ------------------------------ */

/**
 * Live status of the on-demand proxy supply.
 *
 * Note what `credits_*` means here: the provider documents a credit balance and
 * a developer console to recharge it, but the live service exposes neither — its
 * `/api/profile` and `/api/credits` routes return 404, and the documented
 * `X-Credits-Remaining` header is never sent. What it really returns is a
 * rate-limit window, so `rate_remaining` is the number that reflects reality and
 * `credits_remaining` stays null unless a real credits source exists.
 */
export interface NextProxyStatus {
  ok: boolean;
  enabled: boolean;
  reachable: boolean;
  key_present: boolean;
  key_masked: string;
  key_source: "settings" | "config" | "env" | "none";
  base: string;
  path: string;
  auth_style: string;
  tier: string | null;
  pool_total: number | null;
  rate_limit: number | null;
  rate_remaining: number | null;
  rate_reset: number | null;
  credits_remaining: number | null;
  credits_used: number | null;
  credits_source: string | null;
  /** A few real addresses, so the admin can see what a buyer would receive. */
  sample: string[];
  error: string | null;
  checked_at: string;
  cached?: boolean;
}

export interface NextProxyStatusResponse {
  status: NextProxyStatus;
  products: {
    product_id: string;
    label: string;
    country: string;
    protocol: string;
    per_unit: number;
  }[];
  credits_source: string | null;
  rate_limit_source: string | null;
  profile_configured: boolean;
  /** True when the key's credit balance is running low. */
  credits_low?: boolean;
  credits_low_threshold?: number;
  /** What refreshing the console just cost, in credits (0 when cached). */
  probe_cost_credits?: number;
}

export interface NextProxyKeyResponse {
  saved: boolean;
  key_present: boolean;
  key_masked: string;
  key_source: string;
  status: NextProxyStatus;
}

/** Proxy provider status. Pass refresh to bypass the server-side cache. */
export function adminNextProxyStatus(
  refresh = false
): Promise<ApiResult<NextProxyStatusResponse>> {
  return adminFetch(`/admin/nextproxy-status${refresh ? "?refresh=1" : ""}`, {
    method: "GET",
  });
}

/** Stores or clears the proxy provider key. Empty string clears it. */
export function adminSaveNextProxyKey(
  apiKey: string
): Promise<ApiResult<NextProxyKeyResponse>> {
  return adminFetch("/admin/nextproxy-key", {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
}

export function adminDeleteUnit(
  productId: string,
  unitId: string
): Promise<ApiResult<{ deleted: boolean; available: number }>> {
  return adminFetch("/admin/inventory/delete", {
    method: "POST",
    body: JSON.stringify({ productId, unitId }),
  });
}

/* -------------------------- client-side preview ------------------------- */

export interface ParsedLine {
  uid: string;
  secret: string;
  fields: string[];
  wellFormed: boolean;
  /** SMS only. */
  phone?: string;
  inboxUrl?: string;
  notes?: string;
  /** The number has no country code, so its country is ambiguous. */
  needsReview?: boolean;
}

/**
 * Mirrors the server's parser so the admin sees exactly what will be committed
 * before they press the button. Kept deliberately in step with
 * `inventory_parse_lines()` in server/api/lib/inventory.php.
 */
const URL_PATTERN = /^https?:\/\/[^\s<>"]+$/i;

function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "").replace(/^\+/, "");
  return digits ? `+${digits}` : "";
}

/**
 * Validates "IP:PORT" the way the backend does.
 *
 * Kept intentionally close to `proxy_public_ip()` /
 * `proxy_normalize_address()` in server/api/lib/proxyaddr.php: private,
 * loopback, link-local, carrier-NAT and documentation ranges are all refused,
 * because those addresses cannot route for a buyer.
 */
const UNROUTABLE_V4 =
  /^(?:0\.|10\.|100\.(?:6[4-9]|[7-9]\d|1[0-2]\d)\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.0\.0\.|192\.0\.2\.|192\.168\.|198\.1[89]\.|198\.51\.100\.|203\.0\.113\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.)/;

function isPublicAddress(host: string): boolean {
  if (!host) return false;
  // IPv6: bracketed, or containing a colon.
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare.includes(":")) {
    return /^[0-9a-f:]+$/i.test(bare);
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return false;
  if (bare.split(".").some((part) => Number(part) > 255)) return false;
  return !UNROUTABLE_V4.test(bare);
}

function normalizeProxyAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  let host = "";
  let port = "";
  const bracketed = trimmed.match(/^(\[[0-9a-fA-F:]+\]):(\d{1,5})$/);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2];
  } else {
    const at = trimmed.lastIndexOf(":");
    if (at === -1) return "";
    host = trimmed.slice(0, at);
    port = trimmed.slice(at + 1);
  }

  const portNumber = Number(port.trim());
  if (!/^\d{1,5}$/.test(port.trim()) || portNumber < 1 || portNumber > 65535) {
    return "";
  }
  if (!isPublicAddress(host.trim())) return "";

  const bare = host.trim().replace(/^\[|\]$/g, "");
  return bare.includes(":") ? `[${bare}]:${portNumber}` : `${bare}:${portNumber}`;
}

export function parseCredentialLines(
  text: string,
  kind: "credentials" | "sms" | "proxy" = "credentials"
): ParsedLine[] {
  const seen = new Set<string>();
  const out: ParsedLine[] = [];

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (seen.has(line)) continue;
    seen.add(line);

    let fields: string[] = [];
    if (line.includes("|")) {
      fields = line.split("|").map((f) => f.trim());
    } else if (kind === "sms") {
      fields = [line];
    } else if ((line.match(/:/g)?.length ?? 0) >= 2 && !line.includes(" ")) {
      fields = line.split(":").map((f) => f.trim());
    }

    if (kind === "proxy") {
      // Mirrors proxy_normalize_address() on the server: an address without a
      // routable public IP and a real port is refused rather than stored.
      const rawAddress = line.includes("|") ? fields[0] : line;
      const address = normalizeProxyAddress(rawAddress);
      if (!address) continue;
      const extra = line.includes("|") ? fields[1] ?? "" : "";
      out.push({
        uid: address,
        secret: line,
        fields,
        notes: extra || undefined,
        wellFormed: true,
      });
      continue;
    }

    if (kind === "sms") {
      const phone = normalizePhone(fields[0] ?? "");
      if (!phone) continue; // not a number, so not stock
      const second = fields[1] ?? "";
      const isUrl = URL_PATTERN.test(second);
      out.push({
        uid: phone,
        secret: line,
        fields,
        phone,
        inboxUrl: isUrl ? second : undefined,
        notes: isUrl ? undefined : second || undefined,
        // "0712345678" is a valid pattern in several countries, so a missing
        // country code is worth flagging rather than guessing.
        needsReview: phone.startsWith("+0"),
        wellFormed: Boolean(second),
      });
      continue;
    }

    const uid = fields[0] || `UNIT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    out.push({
      uid,
      secret: line,
      fields,
      wellFormed: fields.length >= 2,
    });
  }

  return out;
}
