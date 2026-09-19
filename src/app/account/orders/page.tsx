"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { getUserOrders, type OrderWithId } from "@/lib/orders";
import { formatPrice } from "@/lib/format";
import { asset } from "@/lib/asset";
import { SUPPORT } from "@/lib/config";
import Icon from "@/components/ui/Icon";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  paid: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  delivered: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  refunded:
    "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
};

export default function MyOrdersPage() {
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<OrderWithId[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchOrders() {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        setOrders(await getUserOrders(user.uid));
      } catch (err) {
        console.error("Failed to load orders:", err);
      }
      setLoading(false);
    }
    if (!authLoading) fetchOrders();
  }, [user, authLoading]);

  if (authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-sm text-[var(--color-ink-faint)] animate-pulse">
          Loading…
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--color-line)] flex items-center justify-center mb-4">
          <Icon name="user" className="w-6 h-6 text-[var(--color-ink-faint)]" />
        </div>
        <h1 className="text-xl font-extrabold">Sign in required</h1>
        <p className="text-sm text-[var(--color-ink-soft)] mt-1 mb-5">
          Sign in to see your orders and re-download your accounts.
        </p>
        <Link
          href="/auth/signin/"
          className="px-6 py-3 rounded-xl bg-[var(--color-brand)] text-white text-xs font-bold uppercase tracking-wider"
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      {/* Page header */}
      <div className="bg-[var(--color-panel)] border-b border-[var(--color-line)]">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="font-extrabold uppercase tracking-tight text-lg"
          >
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

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2">
          <Icon name="download" className="w-5 h-5 text-[var(--color-brand)]" />
          <h1 className="text-2xl font-extrabold">My Orders</h1>
        </div>
        <p className="text-sm text-[var(--color-ink-soft)] mt-1 mb-8">
          {orders.length} {orders.length === 1 ? "order" : "orders"} placed
        </p>

        {loading ? (
          <p className="text-center py-12 text-sm text-[var(--color-ink-faint)]">
            Loading your orders…
          </p>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)]">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-line)] flex items-center justify-center mx-auto mb-4">
              <Icon
                name="cart"
                className="w-6 h-6 text-[var(--color-ink-faint)]"
              />
            </div>
            <p className="font-bold">No orders yet</p>
            <p className="text-xs text-[var(--color-ink-soft)] mt-1 mb-5">
              Your accounts and credentials will appear here after your first
              purchase.
            </p>
            <Link
              href="/"
              className="inline-block px-6 py-2.5 rounded-xl bg-[var(--color-brand)] text-white text-xs font-bold uppercase tracking-wider"
            >
              Browse products
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div
                key={order.id}
                className="bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)] p-4 sm:p-5"
              >
                {/* Head */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold">
                      {order.orderRef || `#${order.id.slice(0, 8)}`}
                    </p>
                    <p className="text-[11px] text-[var(--color-ink-faint)] mt-0.5">
                      {order.createdAt
                        ? new Date(order.createdAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span
                      className={`inline-block text-[10px] font-bold px-2.5 py-1 rounded-full uppercase ${
                        STATUS_STYLE[order.status] ?? STATUS_STYLE.pending
                      }`}
                    >
                      {order.status}
                    </span>
                    <p className="font-extrabold text-sm mt-1.5 tabular-nums">
                      {formatPrice(order.totalAmount ?? 0)}
                    </p>
                  </div>
                </div>

                {/* Items */}
                <div className="border-t border-[var(--color-line)] pt-3 space-y-2.5">
                  {(order.items ?? []).map((item, i) => (
                    <div key={`${item.id}-${i}`} className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-[var(--color-page)] flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset(item.image)}
                          alt=""
                          className="w-full h-full object-contain p-1"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-[var(--color-ink-faint)]">
                          Qty {item.quantity}
                        </p>
                      </div>
                      <p className="text-xs font-bold tabular-nums">
                        {formatPrice(item.price * item.quantity)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Footer */}
                <div className="border-t border-[var(--color-line)] mt-3 pt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-[var(--color-ink-faint)]">
                  <span>
                    Paid via{" "}
                    <span className="font-bold text-[var(--color-ink-soft)]">
                      {order.paymentMethod}
                    </span>
                  </span>
                  <span>
                    Delivered to{" "}
                    <span className="font-bold text-[var(--color-ink-soft)]">
                      {order.delivery?.email || order.userEmail}
                    </span>
                  </span>
                </div>

                {(order.status === "pending" || order.status === "failed") && (
                  <a
                    href={`https://wa.me/${SUPPORT.whatsapp}?text=${encodeURIComponent(
                      `Hi, I need help with order ${order.orderRef || order.id}.`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[#25D366] hover:bg-[#1da851] text-white text-xs font-bold transition-colors"
                  >
                    <Icon name="whatsapp" className="w-4 h-4" />
                    Chase this order on WhatsApp
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
