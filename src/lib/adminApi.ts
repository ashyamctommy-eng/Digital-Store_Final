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
}

/**
 * Mirrors the server's parser so the admin sees exactly what will be committed
 * before they press the button. Kept deliberately in step with
 * `inventory_parse_lines()` in server/api/lib/inventory.php.
 */
export function parseCredentialLines(text: string): ParsedLine[] {
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
    } else if ((line.match(/:/g)?.length ?? 0) >= 2 && !line.includes(" ")) {
      fields = line.split(":").map((f) => f.trim());
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
