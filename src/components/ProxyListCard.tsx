"use client";

import { useCallback, useMemo, useState } from "react";
import Icon from "./ui/Icon";
import { copyText } from "@/lib/orderText";
import type { DeliveredCredential } from "@/lib/payments";

interface ProxyListCardProps {
  cred: DeliveredCredential;
}

/**
 * One delivered proxy unit — a list of IP:PORT addresses.
 *
 * The buyer's first action is always "get these into my tool", so the primary
 * control is Copy All. Per-address copying is there for the common case of
 * replacing a single dead address.
 *
 * The list is rendered from the order record, not fetched again, so the
 * addresses a buyer sees are exactly the ones recorded at dispatch time.
 */
export default function ProxyListCard({ cred }: ProxyListCardProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Memoised so the copy/download callbacks are not rebuilt every render.
  const proxies = useMemo(
    () => (Array.isArray(cred.proxies) ? cred.proxies : []),
    [cred.proxies]
  );
  const isDynamic = cred.source === "dynamic";

  const copyAll = useCallback(async () => {
    // Newline-separated, which is what every proxy tool expects on paste.
    const ok = await copyText(proxies.join("\n"));
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1800);
    }
  }, [proxies]);

  const copyOne = useCallback(async (address: string, index: number) => {
    const ok = await copyText(address);
    if (ok) {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    }
  }, []);

  const download = useCallback(() => {
    const lines = [
      `${cred.product_name}`,
      `Proxies (${proxies.length})`,
      "",
      ...proxies,
      "",
      ...(cred.proxy_country ? [`Country: ${cred.proxy_country}`] : []),
      ...(cred.proxy_protocol ? [`Protocol: ${cred.proxy_protocol}`] : []),
      "",
      "These addresses are supplied as IP:PORT.",
      "The pool is shared: an address may be reassigned to another customer later.",
      "Do not send sensitive logins through an address you have not verified.",
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
  }, [cred.product_id, cred.product_name, cred.proxy_country, cred.proxy_protocol, proxies]);

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
          {cred.product_name}
          <span className="ml-2 normal-case tracking-normal font-bold text-[var(--color-ink-soft)]">
            {proxies.length} {proxies.length === 1 ? "address" : "addresses"}
          </span>
          {isDynamic && (
            <span className="ml-2 normal-case tracking-normal font-bold text-[var(--color-blue)]">
              on demand
            </span>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {(cred.proxy_country || cred.proxy_protocol) && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--color-page)] border border-[var(--color-line)] text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
              {[cred.proxy_country, cred.proxy_protocol]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>
      </div>

      {/* Address list — monospace so the form is unambiguous to copy by eye. */}
      <ul className="rounded-xl border border-[var(--color-line)] divide-y divide-[var(--color-line)] overflow-hidden">
        {proxies.map((address, index) => (
          <li
            key={`${address}-${index}`}
            className="flex items-center justify-between gap-2 px-3 py-2 bg-[var(--color-panel)] hover:bg-[var(--color-page)] transition-colors"
          >
            <span className="font-mono text-[12px] font-bold break-all">
              {address}
            </span>
            <button
              type="button"
              onClick={() => copyOne(address, index)}
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
        ))}
        {proxies.length === 0 && (
          <li className="px-3 py-4 text-center text-[11px] text-[var(--color-ink-soft)]">
            No addresses are attached to this line yet.
          </li>
        )}
      </ul>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          type="button"
          onClick={copyAll}
          disabled={proxies.length === 0}
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
          onClick={download}
          disabled={proxies.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--color-line)] text-[11px] font-bold hover:border-[var(--color-brand)] transition-colors disabled:opacity-50"
        >
          <Icon name="download" className="w-3.5 h-3.5" />
          Download .txt
        </button>
      </div>

      {cred.notes && (
        <p className="mt-2 text-[10px] text-[var(--color-ink-soft)] break-words">
          {cred.notes}
        </p>
      )}

      <p className="mt-2 text-[10px] text-[var(--color-ink-faint)] leading-relaxed">
        Paste the list into your proxy tool one address per line. These come from
        a shared pool, so an address can be reassigned later — tell support if one
        stops responding.
      </p>
    </li>
  );
}
