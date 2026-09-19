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

export function adminDeleteUnit(
  productId: string,
  unitId: string
): Promise<ApiResult<{ deleted: boolean; available: number }>> {
  return adminFetch("/admin/inventory/delete", {
    method: "POST",
    body: JSON.stringify({ productId, unitId }),
  });
}

/* ------------------------------- settings -------------------------------- */

/** One configurable key, as the server describes it. */
export interface SettingField {
  key: string;
  label: string;
  type: "text" | "secret" | "url" | "number" | "bool" | "select";
  hint: string | null;
  placeholder: string | null;
  options: string[] | null;
  advanced: boolean;
  required: boolean;
  is_secret: boolean;
  is_set: boolean;
  /** "console" | "config" | "unset" — where the value in force came from. */
  source: "console" | "config" | "unset";
  /** Present for non-secrets only. Secrets are never sent back. */
  value: string | boolean;
  /** A masked hint for secrets, e.g. "pk_l…f3a9". */
  masked: string;
}

export interface SettingGroup {
  id: string;
  label: string;
  blurb: string;
  fields: SettingField[];
}

export interface SetupCheck {
  id: string;
  label: string;
  done: boolean;
  detail: string;
  blocking: boolean;
}

export interface SettingsResponse {
  groups: SettingGroup[];
  checklist: { items: SetupCheck[]; ready_for_payments: boolean; blocking: string[] };
  mode: string;
  not_editable_here: string[];
}

/** The whole console-editable configuration, secrets masked. */
export function adminGetSettings(): Promise<ApiResult<SettingsResponse>> {
  return adminFetch("/admin/settings", { method: "GET" });
}

/**
 * Saves a batch of settings.
 *
 * The server rejects the whole batch if any field fails validation, so a save
 * can never half-apply.
 */
export function adminSaveSettings(
  settings: Record<string, string | boolean>
): Promise<ApiResult<{ saved: string[]; cleared: string[]; groups: SettingGroup[]; checklist: SettingsResponse["checklist"] }>> {
  return adminFetch("/admin/settings", {
    method: "POST",
    body: JSON.stringify({ settings }),
  });
}

export interface IntegrationTestResult {
  integration: string;
  checks: { label: string; ok: boolean; detail: string | null }[];
  ok: boolean;
  error: string | null;
}

/** Asks the live provider whether a credential actually works. */
export function adminTestIntegration(
  integration: "palplus" | "nowpayments" | "resend" | "smsotp" | "proxycheck"
): Promise<ApiResult<IntegrationTestResult>> {
  return adminFetch("/admin/settings/test", {
    method: "POST",
    body: JSON.stringify({ integration }),
  });
}

/* ------------------------------ proxy checker ---------------------------- */

/** Grade and rank proxies before they are sold. Admin key required. */
export function adminCheckProxies(
  input: { text: string } | { productId: string; status?: string }
): Promise<ApiResult<import("./payments").ProxyCheckResponse>> {
  return adminFetch("/admin/proxies/check", {
    method: "POST",
    body: JSON.stringify(input),
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
  /** Proxy only: credentials parsed out of the line. */
  username?: string;
  password?: string;
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

/**
 * Splits a pasted proxy line the way the server does.
 *
 * Accepts every spelling proxy_parse_line() accepts, including the two the
 * owner asked for explicitly:
 *
 *   USER:PASS@HOST:PORT     credentials first
 *   HOST:PORT:USER:PASS     credentials last
 *
 * Splits from the right where it must: a password can contain ':' or '@'.
 */
export function parseProxyLine(
  line: string
): { address: string; username: string; password: string } | null {
  let raw = line.trim();
  if (!raw) return null;

  // A scheme prefix adds nothing we trust; the checker detects the protocol.
  raw = raw.replace(/^[a-z0-9]+:\/\//i, "");

  let addressPart = raw;
  let credPart = "";

  if (raw.includes("|")) {
    const [a, b] = raw.split("|", 2);
    addressPart = a.trim();
    credPart = (b ?? "").trim();
  } else if (raw.includes("@")) {
    const at = raw.lastIndexOf("@");
    credPart = raw.slice(0, at).trim();
    addressPart = raw.slice(at + 1).trim();
  } else {
    const bracketed = raw.match(/^(\[[0-9a-fA-F:]+\]):(\d{1,5})(?::(.*))?$/);
    const colonForm = raw.match(/^([^\s:]+):(\d{1,5}):(.*)$/);
    if (bracketed) {
      addressPart = `${bracketed[1]}:${bracketed[2]}`;
      credPart = (bracketed[3] ?? "").trim();
    } else if (colonForm) {
      addressPart = `${colonForm[1]}:${colonForm[2]}`;
      credPart = colonForm[3].trim();
    }
  }

  const address = normalizeProxyAddress(addressPart);
  if (!address) return null;

  let username = "";
  let password = "";
  if (credPart) {
    const split = credPart.indexOf(":");
    if (split === -1) {
      username = credPart;
    } else {
      username = credPart.slice(0, split);
      password = credPart.slice(split + 1);
    }
  }

  return { address, username, password };
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
      // Mirrors proxy_parse_line() on the server, so the admin sees exactly the
      // addresses and credentials that will be stored.
      const parsed = parseProxyLine(line);
      if (!parsed) continue;
      out.push({
        uid: parsed.address,
        secret: line,
        fields,
        username: parsed.username || undefined,
        password: parsed.password || undefined,
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

/* -------------------------------- orders -------------------------------- */

/**
 * An order record as the PHP ledger stores it (snake_case, the wire format).
 * `order_token` is the buyer's credential-retrieval key; the admin screen can
 * see it so it can help someone who lost their browser.
 */
export interface LedgerOrder {
  order_id: string;
  status?: string;
  account_reference?: string;
  order_token?: string;
  gateway?: string;
  currency?: string;
  amount_usd?: number | null;
  amount_kes?: number | null;
  paid_amount_kes?: number | null;
  paid_amount_usd?: number | null;
  mpesa_receipt?: string | null;
  buyer_email?: string | null;
  buyer_name?: string | null;
  phone?: string | null;
  items?: {
    product_id?: string;
    name?: string;
    quantity?: number;
    /** Recorded at sale time; absent on orders written before that. */
    price_usd?: number;
    line_usd?: number;
  }[];
  deliverables?: unknown[];
  shortfall?: unknown[];
  failure_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  settled_at?: string | null;
  delivered_at?: string | null;
  [key: string]: unknown;
}

export interface AdminOrdersResponse {
  orders: LedgerOrder[];
  totals: {
    scanned: number;
    returned: number;
    truncated: boolean;
    counts: Record<string, number>;
    revenue_usd: number;
  };
}

export function adminListOrders(params?: {
  status?: string;
  q?: string;
  limit?: number;
}): Promise<ApiResult<AdminOrdersResponse>> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.q) search.set("q", params.q);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return adminFetch(`/admin/orders/list${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export function adminSetOrderStatus(
  orderId: string,
  status: string
): Promise<ApiResult<{ order_id: string; status: string; changed: boolean }>> {
  return adminFetch("/admin/orders/status", {
    method: "POST",
    body: JSON.stringify({ orderId, status }),
  });
}
