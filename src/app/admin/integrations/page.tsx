"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { API_BASE } from "@/lib/payments";
import { FX_RATE_KES, CURRENCIES } from "@/lib/currency";
import { SUPPORT } from "@/lib/config";
import {
  adminNextProxyStatus,
  adminSaveNextProxyKey,
  type NextProxyStatusResponse,
} from "@/lib/adminApi";

interface ServerConfig {
  palplus: { configured: boolean; mode: string };
  nowpayments: { configured: boolean; mode: string };
  nextproxy?: {
    configured: boolean;
    enabled: boolean;
    key_present: boolean;
    key_source: string;
    proxy_products: number;
  };
}

/**
 * Integrations console.
 *
 * This screen is deliberately read-only. Provider keys are secrets that live in
 * `server/api/config.php` on the host and are never bundled into the static
 * app, so there is nothing useful to edit here — it reports what the server
 * actually has configured.
 */
export default function AdminIntegrationsPage() {
  const [server, setServer] = useState<ServerConfig | null>(null);
  const [error, setError] = useState("");

  const [proxy, setProxy] = useState<NextProxyStatusResponse | null>(null);
  const [proxyError, setProxyError] = useState("");
  const [proxyLoading, setProxyLoading] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  /** Applies a status response, or an honest reason why there is none. */
  const applyProxyResult = useCallback(
    (res: Awaited<ReturnType<typeof adminNextProxyStatus>>) => {
      if (res.ok && res.data) {
        setProxy(res.data);
        setProxyError("");
        return;
      }
      // 401/503 here means the admin key has not been entered yet.
      setProxyError(
        res.status === 401 || res.status === 503
          ? "Enter the admin key to see live provider status."
          : res.error ?? "Could not reach the provider."
      );
    },
    []
  );

  // The first load happens in the effect (state is only set after the await);
  // the button and post-save refresh share the same path.
  useEffect(() => {
    let cancelled = false;
    adminNextProxyStatus().then((res) => {
      if (!cancelled) applyProxyResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [applyProxyResult]);

  const loadProxy = useCallback(
    async (refresh = false) => {
      setProxyLoading(true);
      const res = await adminNextProxyStatus(refresh);
      setProxyLoading(false);
      applyProxyResult(res);
    },
    [applyProxyResult]
  );

  const saveKey = useCallback(
    async (value: string) => {
      setSavingKey(true);
      const res = await adminSaveNextProxyKey(value);
      setSavingKey(false);
      if (!res.ok || !res.data) {
        setKeyMessage(res.error ?? "Could not save the key.");
        return;
      }
      setProxy((prev) =>
        prev ? { ...prev, status: res.data!.status } : prev
      );
      setKeyDraft("");
      setKeyMessage(
        value === ""
          ? "Key cleared — falling back to config.php."
          : `Key saved and verified against the provider.`
      );
      void loadProxy(true);
    },
    [loadProxy]
  );

  useEffect(() => {
    fetch(`${API_BASE}/config-status`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => setServer(data))
      .catch(() =>
        setError(
          "Could not reach the payment API. On cPanel, make sure the /api folder was uploaded and PHP is enabled for this domain."
        )
      );
  }, []);

  const card =
    "bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)] p-5";
  const rows = server
    ? [
        {
          id: "palplus",
          name: "Palplus",
          subtitle: "M-Pesa STK push — KES",
          configured: server.palplus.configured,
          mode: server.palplus.mode,
          colour: "bg-[#49B642]",
          glyph: "M",
        },
        {
          id: "nowpayments",
          name: "NOWPayments",
          subtitle: "Crypto invoices — USD",
          configured: server.nowpayments.configured,
          mode: server.nowpayments.mode,
          colour: "bg-[#0F172A]",
          glyph: "₿",
        },
      ]
    : [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold">Integrations</h1>
        <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">
          Payment gateways, currency routing and server endpoints
        </p>
      </div>

      <div className="space-y-5 max-w-3xl">
        {/* Gateway status */}
        <div className={card}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] mb-4">
            Gateway Status
          </h2>

          {error ? (
            <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-xl p-3 leading-relaxed">
              {error}
            </p>
          ) : !server ? (
            <p className="text-sm text-[var(--color-ink-faint)] animate-pulse">
              Checking server configuration…
            </p>
          ) : (
            <div className="space-y-2.5">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 rounded-xl bg-[var(--color-page)] p-3.5"
                >
                  <span
                    className={`w-9 h-9 rounded-xl ${row.colour} text-white flex items-center justify-center font-black text-sm flex-shrink-0`}
                  >
                    {row.glyph}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold">{row.name}</p>
                    <p className="text-[10px] text-[var(--color-ink-soft)]">
                      {row.subtitle}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${
                      row.configured
                        ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                        : "bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
                    }`}
                  >
                    {row.configured ? row.mode : "not configured"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-[var(--color-ink-soft)] mt-4 leading-relaxed">
            Keys live in <code>server/api/config.php</code> on the host — never
            in the browser bundle. Add your live keys there and redeploy the
            <code> /api</code> folder.
          </p>
        </div>


        {/* On-demand proxy supply */}
        <div className={card}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
              On-Demand Proxies
            </h2>
            <div className="flex items-center gap-2">
              {proxyLoading && (
                <span className="text-[10px] text-[var(--color-ink-faint)] animate-pulse">
                  checking…
                </span>
              )}
              <button
                type="button"
                onClick={() => loadProxy(true)}
                disabled={proxyLoading}
                className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border border-[var(--color-line)] hover:border-[var(--color-brand)] transition-colors disabled:opacity-50"
              >
                Re-check
              </button>
            </div>
          </div>

          {proxyError ? (
            <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-xl p-3 leading-relaxed">
              {proxyError}
            </p>
          ) : !proxy ? (
            <p className="text-sm text-[var(--color-ink-faint)] animate-pulse">
              Checking the provider…
            </p>
          ) : (
            <>
              {/* Status badge */}
              <div className="flex items-center gap-3 rounded-xl bg-[var(--color-page)] p-3.5 mb-3">
                <span
                  className={`w-9 h-9 rounded-xl text-white flex items-center justify-center font-black text-sm flex-shrink-0 ${
                    proxy.status.ok
                      ? "bg-[var(--color-success)]"
                      : proxy.status.enabled
                        ? "bg-[var(--color-danger)]"
                        : "bg-[var(--color-ink-faint)]"
                  }`}
                >
                  ⇄
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">NextProxy</p>
                  <p className="text-[10px] text-[var(--color-ink-soft)]">
                    IP:PORT pool for {proxy.products.length} proxy product
                    {proxy.products.length === 1 ? "" : "s"}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${
                    proxy.status.ok
                      ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                      : proxy.status.enabled
                        ? "bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
                        : "bg-[var(--color-ink-faint)]/15 text-[var(--color-ink-soft)]"
                  }`}
                >
                  {proxy.status.ok
                    ? "online"
                    : proxy.status.enabled
                      ? "unreachable"
                      : "disabled"}
                </span>
              </div>

              {proxy.status.error && (
                <p className="text-[11px] text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 rounded-xl p-3 mb-3 leading-relaxed">
                  {proxy.status.error}
                </p>
              )}

              {/* Quota — labelled for what it actually is */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <div className="rounded-xl border border-[var(--color-line)] p-2.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
                    Requests left
                  </p>
                  <p className="text-sm font-black tabular-nums mt-0.5">
                    {proxy.status.rate_remaining ?? "—"}
                    {proxy.status.rate_limit != null && (
                      <span className="text-[10px] font-bold text-[var(--color-ink-faint)]">
                        {" "}
                        / {proxy.status.rate_limit}
                      </span>
                    )}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--color-line)] p-2.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
                    API credits
                  </p>
                  <p className="text-sm font-black tabular-nums mt-0.5">
                    {proxy.status.credits_remaining ?? "n/a"}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--color-line)] p-2.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
                    Pool
                  </p>
                  <p className="text-sm font-black tabular-nums mt-0.5">
                    {proxy.status.pool_total?.toLocaleString() ?? "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--color-line)] p-2.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
                    Tier
                  </p>
                  <p className="text-[10px] font-bold mt-1 leading-tight">
                    {proxy.status.tier?.replace(/\s*\(.*\)$/, "") ?? "—"}
                  </p>
                </div>
              </div>

              {/*
                Credits are real, but only reported to authenticated callers and
                only readable from response headers (there is no credits route).
                Cost is per REQUEST, not per address — limit does not matter —
                and /api/health is the one free endpoint.
              */}
              <p className="text-[10px] text-[var(--color-ink-faint)] leading-relaxed mb-3">
                {proxy.status.credits_remaining != null
                  ? "Credits come from the provider's response headers — it has no credits route, so the balance is read from each authenticated request. One credit is charged per request that returns addresses, whatever the limit. The storefront's availability check uses the free /api/health endpoint and costs nothing."
                  : "No key is set, so the provider reports no credit balance — it only tells authenticated callers. Without a key the pool still works, but it is rate-limited to 60 requests/minute and a share of every page comes back masked. Paste a key above to see the balance."}
              </p>

              {proxy.credits_low && (
                <p className="text-[11px] text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 rounded-xl p-3 mb-3 leading-relaxed">
                  Only {proxy.status.credits_remaining} credits left. Each order
                  spends one credit per request, and once they run out the
                  provider returns HTTP 402 and proxy orders fall through to a
                  shortfall. Top up, or stock addresses by hand.
                </p>
              )}

              {proxy.status.sample.length > 0 && (
                <div className="rounded-xl border border-[var(--color-line)] overflow-hidden mb-3">
                  <div className="px-3 py-2 bg-[var(--color-page)] border-b border-[var(--color-line)]">
                    <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                      Sample addresses a buyer would receive
                    </span>
                  </div>
                  <ul className="divide-y divide-[var(--color-line)]">
                    {proxy.status.sample.map((address) => (
                      <li key={address} className="px-3 py-1.5 font-mono text-[11px]">
                        {address}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Key management */}
              <div className="rounded-xl border border-[var(--color-line)] p-3.5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
                    API key
                  </p>
                  <span className="text-[10px] text-[var(--color-ink-faint)] font-mono">
                    {proxy.status.key_present
                      ? `${proxy.status.key_masked} · ${proxy.status.key_source}`
                      : "none — the pool is public"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="password"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="nex_live_…"
                    autoComplete="off"
                    className="flex-1 min-w-[180px] px-3 py-2 rounded-xl bg-[var(--color-page)] border border-[var(--color-line)] text-xs font-mono focus:outline-none focus:border-[var(--color-brand)]"
                  />
                  <button
                    type="button"
                    onClick={() => saveKey(keyDraft.trim())}
                    disabled={savingKey || keyDraft.trim() === ""}
                    className="px-3 py-2 rounded-xl bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white text-[11px] font-bold transition-colors disabled:opacity-50"
                  >
                    Save
                  </button>
                  {proxy.status.key_present && (
                    <button
                      type="button"
                      onClick={() => saveKey("")}
                      disabled={savingKey}
                      className="px-3 py-2 rounded-xl border border-[var(--color-line)] text-[11px] font-bold hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] transition-colors disabled:opacity-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {keyMessage && (
                  <p className="text-[10px] text-[var(--color-ink-soft)] mt-2">
                    {keyMessage}
                  </p>
                )}
                <p className="text-[10px] text-[var(--color-ink-faint)] mt-2 leading-relaxed">
                  A key is optional here — the pool is served publicly, so the
                  store works without one. When set, it is validated, and a wrong
                  key fails every request. It is stored server-side and only ever
                  shown masked.
                </p>
              </div>

              {/*
                These are shared, mirrored addresses from a public pool, not
                dedicated residential or mobile lines. The store's own product
                copy has to match what is actually delivered, so say it here
                where the owner will see it.
              */}
              <p className="text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-xl p-3 mt-3 leading-relaxed">
                <strong>Check this against your product copy.</strong> The pool
                is a shared, publicly-listed set of mirrored proxies — not
                dedicated residential or mobile lines. Latency runs
                150–250&nbsp;ms and the same address can be handed to another
                caller, so any product described as
                &ldquo;static residential&rdquo; or &ldquo;dedicated 4G
                mobile&rdquo; would misrepresent what arrives.
              </p>

              {proxy.products.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {proxy.products.map((product) => (
                    <div
                      key={product.product_id}
                      className="flex items-center gap-2 text-[10px] rounded-lg bg-[var(--color-page)] px-3 py-2"
                    >
                      <code className="font-mono font-bold">
                        {product.product_id}
                      </code>
                      <span className="flex-1 text-[var(--color-ink-soft)]">
                        {product.label}
                      </span>
                      <span className="text-[var(--color-ink-faint)]">
                        {product.per_unit} per unit
                        {product.country ? ` · ${product.country}` : ""}
                        {product.protocol ? ` · ${product.protocol}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Currency routing */}
        <div className={card}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] mb-4">
            Currency Routing
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-[var(--color-line)] p-3.5">
              <p className="text-sm font-bold">
                {CURRENCIES.KES.flag} Kenya — KES
              </p>
              <p className="text-[10px] text-[var(--color-ink-soft)] mt-1 leading-relaxed">
                Detected by IP, or chosen manually. Settles with{" "}
                <span className="font-bold">Palplus (M-Pesa)</span>.
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-line)] p-3.5">
              <p className="text-sm font-bold">
                {CURRENCIES.USD.flag} International — USD
              </p>
              <p className="text-[10px] text-[var(--color-ink-soft)] mt-1 leading-relaxed">
                Everywhere else. Settles with{" "}
                <span className="font-bold">NOWPayments (crypto)</span>.
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--color-page)] px-3.5 py-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
              Exchange rate
            </span>
            <span className="text-sm font-bold tabular-nums">
              1 USD = {FX_RATE_KES} KES
            </span>
          </div>

          <p className="text-[11px] text-[var(--color-ink-soft)] mt-3 leading-relaxed">
            Catalog prices are stored in USD. KES is derived at display and
            checkout time, so the two can never drift. Change{" "}
            <code>FX_RATE_KES</code> in <code>src/lib/currency.ts</code> to
            re-price the store.
          </p>
        </div>

        {/* Endpoints */}
        <div className={card}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] mb-4">
            Server Endpoints
          </h2>
          <div className="space-y-1.5">
            {[
              { method: "POST", path: "/api/palplus/initiate" },
              { method: "GET", path: "/api/orders/status" },
              { method: "POST", path: "/api/palplus/webhook" },
              { method: "POST", path: "/api/nowpayments/create-invoice" },
              { method: "POST", path: "/api/nowpayments/webhook" },
              { method: "GET", path: "/api/config-status" },
              { method: "GET", path: "/api/admin/nextproxy-status" },
              { method: "POST", path: "/api/admin/nextproxy-key" },
            ].map((ep) => (
              <div
                key={ep.path}
                className="flex items-center gap-3 rounded-lg bg-[var(--color-page)] px-3 py-2"
              >
                <span
                  className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                    ep.method === "POST"
                      ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                      : "bg-[var(--color-blue)]/15 text-[var(--color-blue)]"
                  }`}
                >
                  {ep.method}
                </span>
                <code className="text-[11px] font-mono">{ep.path}</code>
              </div>
            ))}
          </div>
        </div>

        {/* Support channels */}
        <div className={card}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] mb-4">
            Support Channels
          </h2>
          <div className="space-y-2">
            {[
              { icon: "whatsapp" as const, label: "WhatsApp", value: SUPPORT.whatsappDisplay },
              { icon: "telegram" as const, label: "Telegram", value: `@${SUPPORT.telegram}` },
              { icon: "headset" as const, label: "Email", value: SUPPORT.email },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center gap-3 rounded-xl bg-[var(--color-page)] p-3"
              >
                <Icon name={row.icon} className="w-4 h-4 text-[var(--color-brand)]" />
                <span className="text-xs font-bold flex-1">{row.label}</span>
                <span className="text-xs text-[var(--color-ink-soft)]">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
