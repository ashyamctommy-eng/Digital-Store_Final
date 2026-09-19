"use client";

import { useCallback, useState } from "react";
import { adminCheckProxies } from "@/lib/adminApi";
import type { ProxyCheckResponse } from "@/lib/payments";

interface ProxyCheckPanelProps {
  /** The product whose stock can be tested. */
  productId: string;
  /** Whatever is currently in the upload box, so it can be tested before saving. */
  pastedText: string;
}

const TONE: Record<string, string> = {
  elite: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  anonymous: "bg-[var(--color-blue)]/15 text-[var(--color-blue)]",
  transparent: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
};

/**
 * Tests and ranks proxy addresses before they are sold.
 *
 * Two ways in: test what is pasted in the upload box (so a bad batch never
 * reaches stock), or test what is already in stock (so a batch that has gone
 * stale can be found and pulled). Addresses are sent through our own reflector,
 * so a result means the proxy actually carried a request — not that it answered
 * a port scan.
 */
export default function ProxyCheckPanel({ productId, pastedText }: ProxyCheckPanelProps) {
  const [running, setRunning] = useState<"" | "text" | "stock">("");
  const [data, setData] = useState<ProxyCheckResponse | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState<"" | "text" | "stock">("");

  const run = useCallback(
    async (which: "text" | "stock") => {
      if (which === "text" && pastedText.trim() === "") {
        setError("Paste some addresses first.");
        return;
      }
      setRunning(which);
      setError("");
      const res =
        which === "text"
          ? await adminCheckProxies({ text: pastedText })
          : await adminCheckProxies({ productId });
      setRunning("");
      if (!res.ok || !res.data) {
        setData(null);
        setError(res.error ?? "Could not test those addresses.");
        return;
      }
      setData(res.data);
      setSource(which);
      if (res.data.error) setError(res.data.error);
    },
    [pastedText, productId]
  );

  const results = data?.results ?? [];

  return (
    <div className="mt-3 rounded-xl border border-[var(--color-line)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
            Proxy checker
          </p>
          <p className="text-[10px] text-[var(--color-ink-faint)] mt-0.5">
            Sends a request through each address, then ranks them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run("text")}
            disabled={running !== "" || pastedText.trim() === ""}
            className="px-3 py-1.5 rounded-lg bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white text-[11px] font-bold transition-colors disabled:opacity-50"
          >
            {running === "text" ? "Testing…" : "Test pasted list"}
          </button>
          <button
            type="button"
            onClick={() => run("stock")}
            disabled={running !== "" || !productId}
            className="px-3 py-1.5 rounded-lg border border-[var(--color-line)] text-[11px] font-bold hover:border-[var(--color-brand)] transition-colors disabled:opacity-50"
          >
            {running === "stock" ? "Testing…" : "Test stock"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-2 text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-lg p-2.5 leading-relaxed">
          {error}
        </p>
      )}

      {data && results.length > 0 && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span className="font-bold">
              {data.summary.healthy}/{data.summary.checked} working
            </span>
            {data.summary.dead > 0 && (
              <span className="text-[var(--color-danger)] font-bold">
                {data.summary.dead} dead
              </span>
            )}
            {data.summary.elite > 0 && (
              <span className="text-[var(--color-success)] font-bold">
                {data.summary.elite} elite
              </span>
            )}
            {data.summary.median_latency_ms != null && (
              <span className="text-[var(--color-ink-soft)]">
                {data.summary.median_latency_ms}ms median
              </span>
            )}
            <span className="text-[var(--color-ink-faint)]">
              best {data.summary.best_score}/100
            </span>
            {typeof data.elapsed_ms === "number" && (
              <span className="text-[var(--color-ink-faint)]">
                checked in {(data.elapsed_ms / 1000).toFixed(1)}s
              </span>
            )}
            {data.truncated && (
              <span className="text-[var(--color-warning)] font-bold">
                first {data.max_checked} only
              </span>
            )}
          </div>

          <div className="mt-2 rounded-lg border border-[var(--color-line)] overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-[var(--color-page)] text-[9px] font-extrabold uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">
                  <th className="px-2 py-2 w-8"> </th>
                  <th className="px-2 py-2">Address</th>
                  <th className="px-2 py-2 w-14 text-right">Score</th>
                  <th className="px-2 py-2 w-20 text-right">Latency</th>
                  <th className="px-2 py-2 w-24">Anonymity</th>
                  <th className="px-2 py-2 w-16">Type</th>
                  <th className="px-2 py-2 w-28">Exit IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {results.map((r, i) => (
                  <tr key={`${r.address}-${i}`} className="text-[11px]">
                    <td className="px-2 py-1.5">
                      <span
                        className={`inline-flex w-4 h-4 rounded-full items-center justify-center text-[9px] font-black text-white ${
                          r.healthy ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]"
                        }`}
                        title={r.healthy ? "Working" : r.error ?? "Not working"}
                      >
                        {r.healthy ? "✓" : "✕"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono break-all">
                      {r.address}
                      {r.username !== "" && (
                        <span className="ml-1.5 text-[9px] text-[var(--color-ink-faint)]">
                          {r.username}:***
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums">
                      {r.healthy ? (
                        <>
                          {r.score}
                          <span className="text-[9px] text-[var(--color-ink-faint)]">
                            {" "}
                            {r.grade}
                          </span>
                        </>
                      ) : (
                        <span className="text-[var(--color-danger)]">0</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.latency_ms != null ? `${r.latency_ms}ms` : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.healthy ? (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider ${
                            TONE[r.anonymity] ?? ""
                          }`}
                        >
                          {r.anonymity}
                        </span>
                      ) : (
                        <span className="text-[9px] text-[var(--color-ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 uppercase text-[9px] font-bold text-[var(--color-ink-soft)]">
                      {r.protocol ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[10px] text-[var(--color-ink-soft)]">
                      {r.exit_ip ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-[var(--color-ink-faint)] mt-2 leading-relaxed">
            {source === "stock"
              ? "These are the addresses currently in stock for this product."
              : "This is the pasted list — nothing has been saved yet."}{" "}
            Score is this store&rsquo;s own 0-100 measure of speed, anonymity and
            protocol. It is not a reputation or fraud report.
            {data.egress_ip && (
              <>
                {" "}
                A &ldquo;transparent&rdquo; result means your own address (
                <span className="font-mono">{data.egress_ip}</span>) reached the
                destination — pull those.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
