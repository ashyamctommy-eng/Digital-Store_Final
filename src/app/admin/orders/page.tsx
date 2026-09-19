"use client";

import { useEffect, useMemo, useState } from "react";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders";
import { toAdminOrderView, type AdminOrderView } from "@/lib/adminOrders";
import { adminListOrders, adminSetOrderStatus } from "@/lib/adminApi";
import { formatPrice } from "@/lib/currency";
import Icon from "@/components/ui/Icon";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  paid: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  delivered:
    "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  refunded:
    "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
};

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrderView[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | OrderStatus>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // The orders fulfilment acted on live in the PHP ledger, so that is what this
  // screen reads. The previous version read a `orders` collection the browser
  // wrote at checkout: a list the customer could edit, and not the list the
  // webhook settled.
  useEffect(() => {
    async function load() {
      const res = await adminListOrders({ limit: 500 });
      if (res.ok && res.data) {
        setOrders(res.data.orders.map(toAdminOrderView));
        setLoadError("");
      } else {
        setLoadError(res.error ?? "Could not load orders.");
      }
      setLoading(false);
    }
    load();
  }, []);

  const updateStatus = async (id: string, status: OrderStatus) => {
    const previous = orders;
    // Optimistic: the row flips immediately, and is put back if the write fails.
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    const res = await adminSetOrderStatus(id, status);
    if (!res.ok) {
      setOrders(previous);
      setLoadError(res.error ?? "Could not update the order status.");
    }
  };

  const filtered = useMemo(() => {
    let list = filter === "all" ? orders : orders.filter((o) => o.status === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((o) =>
        [
          o.id,
          o.orderId,
          o.buyerName,
          o.buyerEmail,
          o.accountReference,
          o.phone,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  }, [orders, filter, search]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold">Orders &amp; Delivery</h1>
          <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">
            {orders.length} total orders
          </p>
        </div>
        <div className="relative">
          <Icon
            name="search"
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order, name, email"
            className="pl-9 pr-3 py-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-sm outline-none focus:border-[var(--color-brand)] w-full sm:w-64"
          />
        </div>
      </div>

      {/* Status filters */}
      <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar pb-1">
        {(["all", ...ORDER_STATUSES] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s as "all" | OrderStatus)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors ${
              filter === s
                ? "bg-[var(--color-ink)] text-[var(--color-panel)]"
                : "bg-[var(--color-panel)] border border-[var(--color-line)] text-[var(--color-ink-soft)] hover:border-[var(--color-brand)]"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-center py-16 text-sm text-[var(--color-ink-faint)]">
            Loading orders…
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-16 text-sm text-[var(--color-ink-faint)]">
            {loadError ? `Could not load orders: ${loadError}` : "No orders to show."}
          </p>
        ) : (
          filtered.map((o) => {
            const isOpen = expanded === o.id;
            return (
              <div
                key={o.id}
                className="bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)] overflow-hidden"
              >
                {/* Summary row */}
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : o.id)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-[var(--color-page)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold">
                        {o.orderId || `#${o.id.slice(0, 8)}`}
                      </span>
                      <span
                        className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          STATUS_STYLE[o.status ?? "pending"] ?? STATUS_STYLE.pending
                        }`}
                      >
                        {o.status}
                      </span>
                      <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-[var(--color-line)] text-[var(--color-ink-soft)]">
                        {o.gateway ?? "—"}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-ink-soft)] mt-1 truncate">
                      {o.buyerName || "—"} · {o.buyerEmail || "—"}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-extrabold text-sm tabular-nums">
                      {formatPrice(o.amountUsd ?? 0, "USD")}
                    </p>
                    <p className="text-[10px] text-[var(--color-ink-faint)]">
                      {o.createdAt
                        ? new Date(o.createdAt).toLocaleDateString()
                        : "—"}
                    </p>
                  </div>
                  <Icon
                    name="chevronDown"
                    className={`w-4 h-4 text-[var(--color-ink-faint)] transition-transform flex-shrink-0 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {/* Detail */}
                {isOpen && (
                  <div className="border-t border-[var(--color-line)] p-4 space-y-4 animate-fade-up">
                    {/* Items */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)] mb-2">
                        Items
                      </p>
                      <ul className="space-y-2">
                        {(o.items ?? []).map((item, i) => (
                          <li
                            key={`${item.product_id}-${i}`}
                            className="flex items-center gap-3 text-xs"
                          >
                            <span className="flex-1 truncate">{item.name}</span>
                            <span className="text-[var(--color-ink-soft)]">
                              ×{item.quantity}
                            </span>
                            <span className="font-bold tabular-nums">
                              {formatPrice(item.price_usd * item.quantity, "USD")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Delivery details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-xl bg-[var(--color-page)] p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)] mb-1.5">
                          Deliver to
                        </p>
                        <p className="text-xs font-semibold">
                          {o.buyerEmail || "—"}
                        </p>
                        <p className="text-xs text-[var(--color-ink-soft)]">
                          {o.phone || "—"}
                        </p>
                        {o.accountReference && (
                          <p className="text-[11px] text-[var(--color-ink-faint)] mt-1.5 font-mono">
                            ref {o.accountReference}
                          </p>
                        )}
                      </div>
                      <div className="rounded-xl bg-[var(--color-page)] p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)] mb-1.5">
                          Payment reference
                        </p>
                        <p className="text-xs font-mono break-all">
                          {o.mpesaReceipt || o.accountReference || "—"}
                        </p>
                        <p className="text-[10px] text-[var(--color-ink-faint)] mt-1.5">
                          Internal id: {o.id}
                        </p>
                        {o.failureReason && (
                          <p className="text-[10px] text-red-600 mt-1.5">
                            {o.failureReason}
                          </p>
                        )}
                        {o.orderToken && (
                          <p className="text-[10px] text-[var(--color-ink-faint)] mt-1.5">
                            Buyer token:{" "}
                            <span className="font-mono">{o.orderToken}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Status control */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
                        Set status
                      </span>
                      {ORDER_STATUSES.map((s) => (
                        <button
                          type="button"
                          key={s}
                          onClick={() => updateStatus(o.id, s)}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                            o.status === s
                              ? STATUS_STYLE[s]
                              : "border border-[var(--color-line)] text-[var(--color-ink-soft)] hover:border-[var(--color-brand)]"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
