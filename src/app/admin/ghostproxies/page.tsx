"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  adminGhostProxies,
  type GhostProxiesResponse,
} from "@/lib/adminApi";

type Resource = "stats" | "settings" | "pools" | "countries" | "locations" | "asn" | "reseller";

const resources: { id: Resource; label: string }[] = [
  { id: "stats", label: "Usage stats" },
  { id: "settings", label: "Account settings" },
  { id: "pools", label: "Pools" },
  { id: "countries", label: "Countries" },
  { id: "locations", label: "Locations" },
  { id: "asn", label: "ASNs" },
  { id: "reseller", label: "Reseller" },
];

export default function AdminGhostProxiesPage() {
  const [resource, setResource] = useState<Resource>("stats");
  const [country, setCountry] = useState("US");
  const [poolType, setPoolType] = useState("residential");
  const [state, setState] = useState("");
  const [result, setResult] = useState<GhostProxiesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextResource: Resource) => {
    setBusy(true);
    setError("");
    const response = await adminGhostProxies(nextResource, {
      country: nextResource === "locations" || nextResource === "asn" ? country : undefined,
      type: nextResource === "locations" || nextResource === "countries" ? poolType : undefined,
      state: nextResource === "locations" ? state : undefined,
    });
    setBusy(false);
    if (!response.ok || !response.data) {
      setError(response.error ?? "Could not load GhostProxies data.");
      return;
    }
    setResult(response.data);
  }, [country, poolType, state]);

  useEffect(() => {
    let cancelled = false;
    void adminGhostProxies("stats").then((response) => {
      if (cancelled) return;
      if (!response.ok || !response.data) {
        setError(response.error ?? "Could not load GhostProxies data.");
        return;
      }
      setResult(response.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const panel = "rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5";
  const input = "rounded-xl border border-[var(--color-line)] bg-[var(--color-page)] px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">GhostProxies</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Review provider status, usage, pools and targeting options. API calls run on the server.
          </p>
        </div>
        <Link
          href="/admin/configurations/"
          className="rounded-xl border border-[var(--color-line)] px-4 py-2 text-sm font-bold hover:bg-[var(--color-line)]"
        >
          Configure API key
        </Link>
      </div>

      <section className={`${panel} mb-5`}>
        <div className="flex flex-wrap items-center gap-2">
          {resources.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => {
                setResource(item.id);
                void load(item.id);
              }}
              className={`rounded-xl px-3 py-2 text-sm font-bold ${
                resource === item.id
                  ? "bg-[var(--color-brand)] text-white"
                  : "bg-[var(--color-page)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {(resource === "locations" || resource === "asn" || resource === "countries") && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="text-xs font-bold text-[var(--color-ink-soft)]" htmlFor="ghost-country">
              Country
            </label>
            {resource !== "countries" && (
            <input
              id="ghost-country"
              className={`${input} w-24 uppercase`}
              maxLength={2}
              value={country}
              onChange={(event) => setCountry(event.target.value.toUpperCase())}
            />
            )}
            {resource === "locations" && (
              <>
                <label className="ml-2 text-xs font-bold text-[var(--color-ink-soft)]" htmlFor="ghost-type">
                  Pool type
                </label>
                <select
                  id="ghost-type"
                  className={input}
                  value={poolType}
                  onChange={(event) => setPoolType(event.target.value)}
                >
                  <option value="residential">Residential</option>
                  <option value="mobile">Mobile</option>
                  <option value="datacenter">Datacenter</option>
                </select>
                <label className="ml-2 text-xs font-bold text-[var(--color-ink-soft)]" htmlFor="ghost-state">
                  State
                </label>
                <input
                  id="ghost-state"
                  className={input}
                  value={state}
                  onChange={(event) => setState(event.target.value)}
                  placeholder="california"
                />
              </>
            )}
            <button
              type="button"
              onClick={() => void load(resource)}
              className="rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm font-bold"
            >
              Refresh
            </button>
          </div>
        )}
      </section>

      <section className={panel}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-bold">{resources.find((item) => item.id === resource)?.label}</h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => void load(resource)}
            className="text-sm font-bold text-[var(--color-brand)] disabled:opacity-50"
          >
            {busy ? "Loading…" : "Refresh"}
          </button>
        </div>
        {error && (
          <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}
        {result && (
          <div>
            <p className="mb-2 text-xs text-[var(--color-ink-faint)]">
              HTTP {result.status} · data returned by GhostProxies
            </p>
            <pre className="max-h-[65vh] overflow-auto rounded-xl bg-[var(--color-page)] p-4 text-xs leading-5 text-[var(--color-ink)]">
              {JSON.stringify(result.data, null, 2)}
            </pre>
          </div>
        )}
        {!result && !error && busy && (
          <p className="text-sm text-[var(--color-ink-soft)]">Connecting to GhostProxies…</p>
        )}
      </section>

      <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
        Proxy products are not offered from static stock. Live order delivery will be enabled after
        the provider&apos;s generated-credential response is confirmed.
      </p>
    </div>
  );
}
