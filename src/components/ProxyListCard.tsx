"use client";

import { useCallback, useMemo, useState } from "react";
import Icon from "./ui/Icon";
import { copyText } from "@/lib/orderText";
import {
  proxyLine,
  verifyOrderProxies,
  type DeliveredCredential,
  type ProxyCheckResult,
} from "@/lib/payments";

interface ProxyListCardProps {
  cred: DeliveredCredential;
  /** Needed to authorise the check; only this order's addresses are tested. */
  orderId?: string;
  token?: string;
}

const ANON_LABEL: Record<string, string> = {
  elite: "Elite",
  anonymous: "Anonymous",
  transparent: "Transparent",
};

const ANON_TONE: Record<string, string> = {
  elite: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  anonymous: "bg-[var(--color-blue)]/15 text-[var(--color-blue)]",
  transparent: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
};

/**
 * One delivered proxy unit.
 *
 * Two jobs, in order of what a buyer actually does: copy the list into their
 * tool, and find out which addresses are alive before they rely on them. The
 * check is the reason a dead address is not a support ticket — the buyer can see
 * it themselves and tell us which one to swap.
 *
 * Results are rendered in the order the server ranked them (best first), so the
 * good addresses are at the top of the list.
 */
export default function ProxyListCard({ cred, orderId, token }: ProxyListCardProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<ProxyCheckResult[] | null>(null);
  const [summary, setSummary] = useState<{
    healthy: number;
    checked: number;
    median_latency_ms: number | null;
  } | null>(null);
  const [checkError, setCheckError] = useState("");

  const auth = useMemo(
    () => (cred.proxy_auth && typeof cred.proxy_auth === "object" ? cred.proxy_auth : {}),
    [cred.proxy_auth]
  );

  // Addresses are the source of truth; results only decorate them.
  const addresses = useMemo(
    () => (Array.isArray(cred.proxies) ? cred.proxies : []),
    [cred.proxies]
  );

  const resultFor = useCallback(
    (address: string) => results?.find((r) => r.address === address) ?? null,
    [results]
  );

  /**
   * Display order.
   *
   * Before a check, the addresses are shown as delivered. Once results are in,
   * the list is RANKED — best working address first, dead ones last — because
   * "which of these should I actually use?" is the question the check answers.
   * The original order is the tiebreak, so equal scores stay stable.
   */
  const ordered = useMemo(() => {
    if (!results) return addresses.map((address) => ({ address, index: 0 }));
    const rank = new Map(results.map((r, i) => [r.address, { score: r.score, i }]));
    return addresses
      .map((address, index) => ({ address, index }))
      .sort((a, b) => {
        const ra = rank.get(a.address);
        const rb = rank.get(b.address);
        // Unchecked addresses keep their place ahead of ranked ones.
        if (!ra && !rb) return a.index - b.index;
        if (!ra) return -1;
        if (!rb) return 1;
        if (rb.score !== ra.score) return rb.score - ra.score;
        return a.index - b.index;
      });
  }, [addresses, results]);

  /** The usable line for one address, credentials included when present. */
  const lineFor = useCallback(
    (address: string) => {
      const inline = auth[address];
      if (typeof inline === "string" && inline !== "") {
        const split = inline.indexOf(":");
        return split === -1
          ? proxyLine({ address, username: inline })
          : proxyLine({
              address,
              username: inline.slice(0, split),
              password: inline.slice(split + 1),
            });
      }
      return address;
    },
    [auth]
  );

  const copyAll = useCallback(async () => {
    const ok = await copyText(addresses.map(lineFor).join("\n"));
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1800);
    }
  }, [addresses, lineFor]);

  const copyOne = useCallback(
    async (line: string, index: number) => {
      const ok = await copyText(line);
      if (ok) {
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 1500);
      }
    },
    []
  );

  const check = useCallback(async () => {
    if (!orderId || !token) {
      setCheckError("This order cannot be verified from here.");
      return;
    }
    setChecking(true);
    setCheckError("");
    const res = await verifyOrderProxies(orderId, token);
    setChecking(false);
    if (!res.ok || !res.data) {
      setCheckError(res.error ?? "Could not test the proxies right now.");
      return;
    }
    setResults(res.data.results);
    setSummary({
      healthy: res.data.summary.healthy,
      checked: res.data.summary.checked,
      median_latency_ms: res.data.summary.median_latency_ms,
    });
    if (res.data.error) setCheckError(res.data.error);
  }, [orderId, token]);

  const download = useCallback(() => {
    const lines = [
      cred.product_name,
      `Proxies (${addresses.length})`,
      "",
      ...addresses.map(lineFor),
      "",
      "Format: user:pass@host:port, or host:port when no auth is needed.",
      "Use “Test these proxies” in your order page to confirm which are live.",
    ];
    const blob = new Blob([lines.join("\n") + "\n"], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `proxies-${cred.product_id || "order"}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [addresses, cred.product_id, cred.product_name, lineFor]);

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
          {cred.product_name}
          <span className="ml-2 normal-case tracking-normal font-bold text-[var(--color-ink-soft)]">
            {addresses.length} {addresses.length === 1 ? "address" : "addresses"}
          </span>
        </p>
        {summary && (
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-extrabold uppercase tracking-wider ${
              summary.healthy === summary.checked
                ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                : "bg-[var(--color-warning)]/15 text-[var(--color-warning)]"
            }`}
          >
            {summary.healthy}/{summary.checked} working
            {summary.median_latency_ms != null && ` · ${summary.median_latency_ms}ms median`}
          </span>
        )}
      </div>

      {/* Address list — credentials shown, because a proxy needing auth is
          unusable without them. */}
      <ul className="rounded-xl border border-[var(--color-line)] divide-y divide-[var(--color-line)] overflow-hidden">
        {ordered.map(({ address }, position) => {
          const index = position;
          const line = lineFor(address);
          const result = resultFor(address);
          const hasAuth = typeof auth[address] === "string" && auth[address] !== "";
          return (
            <li
              key={`${address}-${index}`}
              // Stable hook for tests and for the rank assertion.
              data-proxy-row={address}
              className="flex items-center justify-between gap-2 px-3 py-2 bg-[var(--color-panel)] hover:bg-[var(--color-page)] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {result && (
                    <span
                      aria-label={result.healthy ? "Working" : "Not working"}
                      title={result.healthy ? "Working" : result.error ?? "Not working"}
                      className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black text-white ${
                        result.healthy
                          ? "bg-[var(--color-success)]"
                          : "bg-[var(--color-danger)]"
                      }`}
                    >
                      {result.healthy ? "✓" : "✕"}
                    </span>
                  )}
                  <span className="font-mono text-[12px] font-bold break-all">
                    {address}
                  </span>
                  {hasAuth && (
                    <span
                      title="This address needs a username and password"
                      className="shrink-0 px-1.5 py-0.5 rounded bg-[var(--color-page)] border border-[var(--color-line)] text-[8px] font-bold uppercase tracking-wider text-[var(--color-ink-soft)]"
                    >
                      auth
                    </span>
                  )}
                </div>

                {hasAuth && (
                  <p className="font-mono text-[10px] text-[var(--color-ink-soft)] break-all mt-0.5">
                    {auth[address]}
                  </p>
                )}

                {result && (
                  <p className="text-[9px] mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wider ${
                        result.healthy
                          ? result.grade === "poor"
                            ? "bg-[var(--color-warning)]/15 text-[var(--color-warning)]"
                            : "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                          : "bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
                      }`}
                    >
                      {result.healthy ? `${result.score}/100 · ${result.grade}` : "dead"}
                    </span>
                    {result.healthy && (
                      <>
                        <span className="text-[var(--color-ink-soft)]">
                          {result.latency_ms}ms · {result.speed}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wider ${
                            ANON_TONE[result.anonymity] ?? ""
                          }`}
                        >
                          {ANON_LABEL[result.anonymity] ?? result.anonymity}
                        </span>
                        {result.protocol && (
                          <span className="text-[var(--color-ink-faint)] uppercase">
                            {result.protocol}
                          </span>
                        )}
                      </>
                    )}
                    {!result.healthy && result.error && (
                      <span className="text-[var(--color-ink-soft)]">
                        {result.error}
                      </span>
                    )}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => copyOne(line, index)}
                aria-label={`Copy ${address}`}
                className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-colors ${
                  copiedIndex === index
                    ? "bg-[var(--color-success)] text-white"
                    : "border border-[var(--color-line)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
                }`}
              >
                <Icon name={copiedIndex === index ? "check" : "download"} className="w-3 h-3" />
                {copiedIndex === index ? "Copied" : "Copy"}
              </button>
            </li>
          );
        })}
        {addresses.length === 0 && (
          <li className="px-3 py-4 text-center text-[11px] text-[var(--color-ink-soft)]">
            No addresses are attached to this line yet.
          </li>
        )}
      </ul>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          type="button"
          onClick={copyAll}
          disabled={addresses.length === 0}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold transition-colors ${
            copiedAll
              ? "bg-[var(--color-success)] text-white"
              : "bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white disabled:opacity-50"
          }`}
        >
          <Icon name={copiedAll ? "check" : "grid"} className="w-3.5 h-3.5" />
          {copiedAll ? "Copied all" : "Copy All Proxies"}
        </button>

        <button
          type="button"
          onClick={check}
          disabled={checking || addresses.length === 0 || !token}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--color-line)] text-[11px] font-bold hover:border-[var(--color-brand)] transition-colors disabled:opacity-50"
        >
          {checking ? (
            <>
              <span className="w-3 h-3 rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-brand)] animate-spin" />
              Testing…
            </>
          ) : (
            <>
              <Icon name="check" className="w-3.5 h-3.5" />
              {results ? "Test again" : "Test these proxies"}
            </>
          )}
        </button>

        <button
          type="button"
          onClick={download}
          disabled={addresses.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--color-line)] text-[11px] font-bold hover:border-[var(--color-brand)] transition-colors disabled:opacity-50"
        >
          <Icon name="download" className="w-3.5 h-3.5" />
          Download .txt
        </button>
      </div>

      {checkError && (
        <p className="mt-2 text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-xl p-2.5 leading-relaxed">
          {checkError}
        </p>
      )}

      {results && !checkError && (
        <p className="mt-2 text-[10px] text-[var(--color-ink-faint)] leading-relaxed">
          Each address was tested by sending a request through it. “Elite” means
          nothing of yours leaked to the destination, “transparent” means your
          real address was forwarded — treat those as unsafe for anything
          sensitive. Scores are our own measurement of speed, anonymity and
          protocol, not a reputation report.
        </p>
      )}

      {!results && (
        <p className="mt-2 text-[10px] text-[var(--color-ink-faint)] leading-relaxed">
          Paste the list into your proxy tool one address per line, or test them
          first to see which are live.
        </p>
      )}
    </li>
  );
}
