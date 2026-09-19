"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./ui/Icon";
import { fetchCredentials, type DeliveredCredential } from "@/lib/payments";
import type { LocalOrder } from "@/lib/orderStore";
import {
  SMS_WARNINGS,
  PROXY_WARNINGS,
  USAGE_WARNINGS,
  allCredentialsText,
  copyText,
  downloadOrderText,
} from "@/lib/orderText";
import SmsNumberCard from "./SmsNumberCard";
import ProxyListCard from "./ProxyListCard";

interface OrderDetailsModalProps {
  order: LocalOrder;
  onClose: () => void;
  onDelete: (orderId: string) => void;
}

const STATUS_TONE: Record<string, string> = {
  paid: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  pending: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  delivered: "bg-[var(--color-blue)]/15 text-[var(--color-blue)]",
  failed: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  cancelled: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  expired: "bg-[var(--color-ink-faint)]/15 text-[var(--color-ink-soft)]",
  unknown: "bg-[var(--color-ink-faint)]/15 text-[var(--color-ink-soft)]",
};

export default function OrderDetailsModal({
  order,
  onClose,
  onDelete,
}: OrderDetailsModalProps) {
  // Whether we can fetch at all is known up front, so it is derived rather
  // than pushed into state from an effect.
  const hasToken = Boolean(order.token);
  const [credentials, setCredentials] = useState<DeliveredCredential[] | null>(null);
  const [loading, setLoading] = useState(hasToken);
  const [note, setNote] = useState("");
  const [copiedAll, setCopiedAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;

    fetchCredentials(order.orderId, order.token)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setCredentials(res.data.credentials);
          if (res.data.credentials.length === 0) {
            setNote(
              res.data.status === "pending"
                ? "This order is still confirming with the payment provider."
                : "No credentials are attached to this order yet."
            );
          }
        } else {
          setNote(res.error ?? "Could not load the credentials for this order.");
        }
      })
      .catch(() => {
        if (!cancelled) setNote("Could not reach the server.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [order.orderId, order.token, hasToken]);

  const smsNumbers = (credentials ?? []).filter((c) => c.kind === "sms");
  const proxyUnits = (credentials ?? []).filter((c) => c.kind === "proxy");
  const plainCredentials = (credentials ?? []).filter(
    (c) => c.kind !== "sms" && c.kind !== "proxy"
  );
  const hasSms = smsNumbers.length > 0 || order.items.some((i) => i.product_id.startsWith("sms-"));
  const hasProxy =
    proxyUnits.length > 0 || order.items.some((i) => i.product_id.startsWith("proxy-"));
  // The banner shows one set of warnings; a mixed order gets both lists.
  const bannerWarnings = [
    ...(hasSms ? SMS_WARNINGS : []),
    ...(hasProxy ? PROXY_WARNINGS : []),
    ...(hasSms || hasProxy ? [] : USAGE_WARNINGS),
  ];

  const totalQty = order.items.reduce((sum, i) => sum + i.quantity, 0);
  const productTitle =
    order.items.length === 1
      ? order.items[0].name
      : `${order.items[0]?.name ?? "Order"} +${order.items.length - 1} more`;

  const handleCopyAll = useCallback(async () => {
    if (!credentials?.length) return;
    const ok = await copyText(allCredentialsText(credentials));
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1600);
    }
  }, [credentials]);

  const handleDownload = () => {
    downloadOrderText(order, credentials ?? []);
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Order ${order.orderId}`}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full sm:max-w-2xl bg-[var(--color-panel)] rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[94dvh] flex flex-col animate-pop-in">
        {/* ---------------- Banner ---------------- */}
        <div className="relative bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-brand-strong)] text-white rounded-t-3xl sm:rounded-t-2xl p-5 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>

          <span
            className={`inline-block text-[9px] font-extrabold uppercase tracking-[0.15em] px-2.5 py-1 rounded-full ${
              STATUS_TONE[order.status] ?? STATUS_TONE.unknown
            }`}
          >
            {order.status}
          </span>

          <h2 className="text-lg font-extrabold leading-tight mt-2 pr-10">
            {productTitle}
          </h2>

          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] opacity-70">
                Quantity
              </p>
              <p className="text-base font-extrabold tabular-nums">{totalQty}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] opacity-70">
                Total paid
              </p>
              <p className="text-base font-extrabold tabular-nums">
                {order.currency} {order.amount.toLocaleString()}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] opacity-70">
                Reference
              </p>
              <p className="text-[11px] font-mono font-bold truncate">
                {order.orderId}
              </p>
            </div>
          </div>
        </div>

        {/* Usage warnings */}
        <div className="bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/25 px-5 py-3 flex-shrink-0">
          <ul className="space-y-1">
            {bannerWarnings.map((w) => (
              <li
                key={w}
                className="flex items-start gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300"
              >
                <Icon name="shield" className="w-3 h-3 mt-0.5 flex-shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>

        {/* ---------------- Actions ---------------- */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-[var(--color-line)] flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--color-line)] text-[11px] font-bold uppercase tracking-wider hover:bg-[var(--color-line)] transition-colors"
          >
            <Icon name="chevronLeft" className="w-3.5 h-3.5" />
            Back
          </button>

          <button
            type="button"
            onClick={handleCopyAll}
            disabled={!credentials?.length}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-40 ${
              copiedAll
                ? "bg-[var(--color-success)] text-white"
                : "border border-[var(--color-line)] hover:border-[var(--color-brand)]"
            }`}
          >
            <Icon name={copiedAll ? "check" : "download"} className="w-3.5 h-3.5" />
            {copiedAll ? "Copied" : "Copy"}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--color-line)] text-[11px] font-bold uppercase tracking-wider hover:border-[var(--color-brand)] transition-colors"
          >
            <Icon name="download" className="w-3.5 h-3.5" />
            Download .txt
          </button>

          <button
            type="button"
            onClick={() => {
              if (confirmDelete) {
                onDelete(order.orderId);
                onClose();
              } else {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 4000);
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors ml-auto ${
              confirmDelete
                ? "bg-[var(--color-danger)] text-white"
                : "text-[var(--color-danger)] border border-[var(--color-danger)]/30 hover:bg-[var(--color-danger)]/10"
            }`}
          >
            <Icon name="trash" className="w-3.5 h-3.5" />
            {confirmDelete ? "Confirm" : "Delete"}
          </button>
        </div>

        {/* ---------------- Credentials ---------------- */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="text-center py-10 text-sm text-[var(--color-ink-faint)] animate-pulse">
              Loading credentials…
            </p>
          ) : credentials && credentials.length > 0 ? (
            <>
              {/* SMS numbers: number + inbox, with an optional embedded view */}
              {smsNumbers.length > 0 && (
                <div className="rounded-2xl border border-[var(--color-line)] overflow-hidden mb-4">
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[var(--color-page)] border-b border-[var(--color-line)]">
                    <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                      Numbers &amp; live inbox
                    </span>
                    <span className="text-[9px] font-bold text-[var(--color-ink-faint)]">
                      {smsNumbers.length}
                    </span>
                  </div>
                  <ul className="divide-y divide-[var(--color-line)]">
                    {smsNumbers.map((cred, i) => (
                      <SmsNumberCard
                        key={`${cred.uid}-${i}`}
                        cred={cred}
                        orderId={order.orderId}
                        token={order.token}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {/* Proxy units: the IP:PORT list, with Copy All */}
              {proxyUnits.length > 0 && (
                <div className="rounded-2xl border border-[var(--color-line)] overflow-hidden mb-4">
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[var(--color-page)] border-b border-[var(--color-line)]">
                    <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                      Proxy addresses
                    </span>
                    <span className="text-[9px] font-bold text-[var(--color-ink-faint)]">
                      {proxyUnits.reduce((n, u) => n + (u.proxies?.length ?? 0), 0)}
                    </span>
                  </div>
                  <ul className="divide-y divide-[var(--color-line)]">
                    {proxyUnits.map((cred, i) => (
                      <ProxyListCard
                        key={`${cred.uid}-${i}`}
                        cred={cred}
                        orderId={order.orderId}
                        token={order.token}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {/* Everything else: the standard credential table */}
              {plainCredentials.length > 0 && (
                <div className="rounded-2xl border border-[var(--color-line)] overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-[var(--color-page)] text-[9px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                        <th className="px-3 py-2.5 w-[34%]">UID</th>
                        <th className="px-3 py-2.5">Account Data</th>
                        <th className="px-3 py-2.5 w-16 text-right">Copy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plainCredentials.map((cred, i) => (
                        <CredentialTableRow key={`${cred.uid}-${i}`} cred={cred} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-10">
              <div className="w-12 h-12 rounded-full bg-[var(--color-line)] flex items-center justify-center mx-auto mb-3">
                <Icon
                  name="clock"
                  className="w-5 h-5 text-[var(--color-ink-faint)]"
                />
              </div>
              <p className="text-sm font-bold">Credentials not available yet</p>
              <p className="text-xs text-[var(--color-ink-soft)] mt-1 max-w-sm mx-auto leading-relaxed">
                {!hasToken
                  ? "No retrieval token is stored for this order on this device. Contact support with your order reference and we will re-send your credentials."
                  : note || "They will appear here as soon as the order is fulfilled."}
              </p>
            </div>
          )}

          {/* Order meta */}
          <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-[var(--color-page)] p-3">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
                Placed
              </dt>
              <dd className="font-semibold mt-0.5">
                {new Date(order.createdAt).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
            <div className="rounded-xl bg-[var(--color-page)] p-3">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
                Payment
              </dt>
              <dd className="font-semibold mt-0.5">{order.paymentMethod}</dd>
            </div>
            <div className="rounded-xl bg-[var(--color-page)] p-3 col-span-2">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
                Delivered to
              </dt>
              <dd className="font-semibold mt-0.5 break-all">
                {order.buyerEmail}
              </dd>
            </div>
          </dl>

          {note && credentials && credentials.length > 0 && (
            <p className="mt-3 text-[11px] text-[var(--color-ink-soft)] leading-relaxed">
              {note}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CredentialTableRow({ cred }: { cred: DeliveredCredential }) {
  const [copied, setCopied] = useState(false);

  return (
    <tr className="border-t border-[var(--color-line)] align-top">
      <td className="px-3 py-2.5">
        <p className="font-mono text-[11px] font-bold break-all">{cred.uid}</p>
        <p className="text-[9px] text-[var(--color-ink-faint)] mt-0.5">
          {cred.product_name}
        </p>
      </td>
      <td className="px-3 py-2.5">
        <p className="font-mono text-[11px] break-all text-[var(--color-ink-soft)]">
          {cred.account_data}
        </p>
      </td>
      <td className="px-3 py-2.5 text-right">
        <button
          type="button"
          onClick={async () => {
            const ok = await copyText(cred.account_data);
            if (ok) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
          aria-label={`Copy credential ${cred.uid}`}
          className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-colors ${
            copied
              ? "bg-[var(--color-success)] text-white"
              : "border border-[var(--color-line)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
          }`}
        >
          <Icon name={copied ? "check" : "download"} className="w-3 h-3" />
          {copied ? "Done" : "Copy"}
        </button>
      </td>
    </tr>
  );
}
