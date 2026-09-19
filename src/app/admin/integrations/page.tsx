"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { API_BASE } from "@/lib/payments";
import { FX_RATE_KES, CURRENCIES } from "@/lib/currency";
import { SUPPORT } from "@/lib/config";

interface ServerConfig {
  palplus: { configured: boolean; mode: string };
  nowpayments: { configured: boolean; mode: string };
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
              { method: "POST", path: "/api/admin/proxies/check" },
              { method: "POST", path: "/api/orders/proxies-check" },
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
