"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useOrders, type LocalOrder } from "@/lib/orderStore";
import { getUserOrders, type OrderWithId } from "@/lib/orders";
import { fetchCredentials, type OrderStatus } from "@/lib/payments";
import { downloadOrderText } from "@/lib/orderText";
import OrderDetailsModal from "@/components/OrderDetailsModal";
import Icon from "@/components/ui/Icon";

type DateFilter = "all" | "today" | "7d" | "30d";

const DATE_OPTIONS: { id: DateFilter; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

const STATUS_TONE: Record<string, string> = {
  paid: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  pending: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  failed: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  cancelled: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  expired: "bg-[var(--color-ink-faint)]/15 text-[var(--color-ink-soft)]",
  unknown: "bg-[var(--color-ink-faint)]/15 text-[var(--color-ink-soft)]",
};

/** Maps a Firestore order into the local shape so both can share one table. */
function fromFirestore(o: OrderWithId): LocalOrder {
  const rawStatus = String(o.status ?? "pending");
  const status: OrderStatus =
    rawStatus === "delivered"
      ? "paid"
      : rawStatus === "refunded"
        ? "cancelled"
        : (rawStatus as OrderStatus);

  return {
    orderId: o.orderId ?? o.id,
    // Firestore never stores the retrieval token; the modal explains that.
    token: "",
    createdAt:
      o.createdAt instanceof Date ? o.createdAt.toISOString() : new Date().toISOString(),
    status,
    paymentMethod: o.paymentMethod ?? "—",
    currency: o.displayCurrency ?? "USD",
    amount: o.displayAmount ?? o.amountUsd ?? 0,
    amountUsd: o.amountUsd ?? 0,
    buyerEmail: o.delivery?.email ?? o.userEmail ?? "",
    items: (o.items ?? []).map((i) => ({
      product_id: i.id,
      name: i.name,
      quantity: i.quantity,
    })),
  };
}

export default function OrderHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const { orders: localOrders, remove } = useOrders();

  const [cloudOrders, setCloudOrders] = useState<LocalOrder[]>([]);
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openOrder, setOpenOrder] = useState<LocalOrder | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  // Signed-in customers also have a copy in Firestore, which is what makes
  // history follow them to a new device.
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    getUserOrders(user.uid)
      .then((rows) => {
        if (!cancelled) setCloudOrders(rows.map(fromFirestore));
      })
      .catch(() => {
        /* offline or rules deny — the local list still works */
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const allOrders = useMemo(() => {
    // Local records win: they carry the retrieval token and the live status.
    const byId = new Map<string, LocalOrder>();
    for (const o of cloudOrders) byId.set(o.orderId, o);
    for (const o of localOrders) byId.set(o.orderId, o);
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [localOrders, cloudOrders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cutoff = (() => {
      const now = new Date();
      if (dateFilter === "today") {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      }
      if (dateFilter === "7d") return now.getTime() - 7 * 864e5;
      if (dateFilter === "30d") return now.getTime() - 30 * 864e5;
      return 0;
    })();

    return allOrders.filter((o) => {
      if (new Date(o.createdAt).getTime() < cutoff) return false;
      if (!q) return true;
      return [
        o.orderId,
        o.paymentMethod,
        o.buyerEmail,
        ...o.items.map((i) => i.name),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [allOrders, query, dateFilter]);

  const allSelected = filtered.length > 0 && filtered.every((o) => selected.has(o.orderId));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(filtered.map((o) => o.orderId)));
  };

  const toggleOne = (orderId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const handleBulkDelete = () => {
    if (!someSelected) return;
    remove(Array.from(selected));
    setNotice(
      `${selected.size} order${selected.size === 1 ? "" : "s"} removed from this device.`
    );
    setSelected(new Set());
    setTimeout(() => setNotice(""), 4000);
  };

  /** Downloads an order's credentials as .txt, fetching them first. */
  const handleDownload = async (order: LocalOrder) => {
    setBusyId(order.orderId);
    setNotice("");
    try {
      let creds: Awaited<ReturnType<typeof fetchCredentials>>["data"] = undefined;
      if (order.token) {
        const res = await fetchCredentials(order.orderId, order.token);
        creds = res.data;
      }
      downloadOrderText(order, creds?.credentials ?? []);
      if (!creds?.credentials?.length) {
        setNotice(
          "Exported the order summary. Credentials are not attached yet — see Order Details for the current status."
        );
        setTimeout(() => setNotice(""), 5000);
      }
    } finally {
      setBusyId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-sm text-[var(--color-ink-faint)] animate-pulse">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      {/* Header */}
      <div className="bg-[var(--color-panel)] border-b border-[var(--color-line)]">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <Link href="/" className="font-extrabold uppercase tracking-tight text-lg">
            DIGITAL<span className="text-[var(--color-brand)]">HUB SHOP</span>
          </Link>
          <Link
            href="/"
            className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors"
          >
            Back to store
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2">
          <Icon name="download" className="w-5 h-5 text-[var(--color-brand)]" />
          <h1 className="text-2xl font-extrabold">Order History</h1>
        </div>
        <p className="text-sm text-[var(--color-ink-soft)] mt-1">
          {allOrders.length} {allOrders.length === 1 ? "order" : "orders"} on this
          device
          {user ? " and in your account" : ""}
        </p>

        {!user && (
          <p className="mt-3 text-[11px] text-[var(--color-ink-soft)] bg-[var(--color-line)] rounded-xl p-3 leading-relaxed">
            You are browsing as a guest, so this list is stored in this browser
            only.{" "}
            <Link
              href="/auth/signin/"
              className="font-bold text-[var(--color-brand)] hover:underline"
            >
              Sign in
            </Link>{" "}
            to keep your orders across devices.
          </p>
        )}

        {/* Toolbar */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[180px]">
            <span className="sr-only">Search orders</span>
            <Icon
              name="search"
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by reference, product or email"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-sm outline-none focus:border-[var(--color-brand)]"
            />
          </label>

          <label className="relative">
            <span className="sr-only">Filter by date</span>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="appearance-none pl-3 pr-9 py-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-xs font-bold outline-none focus:border-[var(--color-brand)]"
            >
              {DATE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <Icon
              name="chevronDown"
              className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-ink-faint)]"
            />
          </label>

          {someSelected && (
            <button
              type="button"
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[var(--color-danger)] text-white text-xs font-bold uppercase tracking-wider"
            >
              <Icon name="trash" className="w-3.5 h-3.5" />
              Delete {selected.size} order{selected.size === 1 ? "" : "s"}
            </button>
          )}
        </div>

        {notice && (
          <p className="mt-3 text-[11px] text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/25 rounded-xl p-3 leading-relaxed">
            {notice}
          </p>
        )}

        {/* Table */}
        {filtered.length === 0 ? (
          <div className="mt-8 text-center py-16 bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)]">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-line)] flex items-center justify-center mx-auto mb-4">
              <Icon name="cart" className="w-6 h-6 text-[var(--color-ink-faint)]" />
            </div>
            <p className="font-bold">
              {allOrders.length === 0 ? "No orders yet" : "No orders match your filters"}
            </p>
            <p className="text-xs text-[var(--color-ink-soft)] mt-1 mb-5">
              {allOrders.length === 0
                ? "Your credentials will appear here after your first purchase."
                : "Try a different search term or widen the date filter."}
            </p>
            {allOrders.length === 0 && (
              <Link
                href="/"
                className="inline-block px-6 py-2.5 rounded-xl bg-[var(--color-brand)] text-white text-xs font-bold uppercase tracking-wider"
              >
                Browse products
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[560px]">
                <thead>
                  <tr className="bg-[var(--color-page)] text-[9px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                    <th className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all orders"
                        className="w-4 h-4 rounded border-[var(--color-line)] accent-[var(--color-brand)]"
                      />
                    </th>
                    <th className="px-3 py-3 w-28">Action</th>
                    <th className="px-3 py-3">Transaction ID</th>
                    <th className="px-3 py-3">Product Name</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((order) => {
                    const qty = order.items.reduce((s, i) => s + i.quantity, 0);
                    const productLabel =
                      order.items.length === 1
                        ? order.items[0].name
                        : `${order.items[0]?.name ?? "Order"} +${order.items.length - 1}`;
                    return (
                      <tr
                        key={order.orderId}
                        className="border-t border-[var(--color-line)] hover:bg-[var(--color-page)] transition-colors"
                      >
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(order.orderId)}
                            onChange={() => toggleOne(order.orderId)}
                            aria-label={`Select order ${order.orderId}`}
                            className="w-4 h-4 rounded border-[var(--color-line)] accent-[var(--color-brand)]"
                          />
                        </td>

                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setOpenOrder(order)}
                              aria-label={`View order ${order.orderId}`}
                              title="View order"
                              className="p-1.5 rounded-lg text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] hover:bg-[var(--color-brand)]/10 transition-colors"
                            >
                              <Icon name="search" className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownload(order)}
                              disabled={busyId === order.orderId}
                              aria-label={`Download order ${order.orderId}`}
                              title="Download .txt"
                              className="p-1.5 rounded-lg text-[var(--color-ink-soft)] hover:text-[var(--color-blue)] hover:bg-[var(--color-blue)]/10 transition-colors disabled:opacity-40"
                            >
                              {busyId === order.orderId ? (
                                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity=".25" />
                                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity=".75" />
                                </svg>
                              ) : (
                                <Icon name="download" className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => remove([order.orderId])}
                              aria-label={`Delete order ${order.orderId}`}
                              title="Delete order"
                              className="p-1.5 rounded-lg text-[var(--color-ink-soft)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
                            >
                              <Icon name="trash" className="w-4 h-4" />
                            </button>
                          </div>
                        </td>

                        <td className="px-3 py-3">
                          <p className="font-mono text-[11px] font-bold break-all">
                            {order.orderId}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                STATUS_TONE[order.status] ?? STATUS_TONE.unknown
                              }`}
                            >
                              {order.status}
                            </span>
                            <span className="text-[10px] text-[var(--color-ink-faint)]">
                              {new Date(order.createdAt).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </span>
                          </div>
                        </td>

                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => setOpenOrder(order)}
                            className="text-left text-xs font-semibold hover:text-[var(--color-brand)] transition-colors"
                          >
                            {productLabel}
                          </button>
                          <p className="text-[10px] text-[var(--color-ink-faint)] mt-0.5">
                            {qty} × {order.currency} {order.amount.toLocaleString()}
                            {" · "}
                            {order.paymentMethod}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {filtered.length > 0 && (
          <p className="text-[10px] text-[var(--color-ink-faint)] mt-3 leading-relaxed">
            Deleting an order only removes it from this list. Your credentials
            stay in your email and remain retrievable from the download link —
            contact support if you need them re-sent.
          </p>
        )}
      </div>

      {openOrder && (
        <OrderDetailsModal
          order={openOrder}
          onClose={() => setOpenOrder(null)}
          onDelete={(orderId) => {
            remove([orderId]);
            setNotice("Order removed from this device.");
            setTimeout(() => setNotice(""), 4000);
          }}
        />
      )}
    </div>
  );
}
