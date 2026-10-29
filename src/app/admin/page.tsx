"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/currency";
import {
  adminListOrders,
  adminListStock,
  type AdminOrdersResponse,
  type InventoryListResponse,
} from "@/lib/adminApi";
import { toAdminOrderView } from "@/lib/adminOrders";
import { products } from "@/lib/products";

const LOW_STOCK_LIMIT = 10;

export default function AdminDashboard() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<AdminOrdersResponse | null>(null);
  const [stock, setStock] = useState<InventoryListResponse | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([adminListOrders({ limit: 10 }), adminListStock()]).then(
      ([orderResult, stockResult]) => {
        if (cancelled) return;
        setLoading(false);

        if (orderResult.ok && orderResult.data) setOrders(orderResult.data);
        if (stockResult.ok && stockResult.data) setStock(stockResult.data);
        const failures = [orderResult, stockResult]
          .filter((result) => !result.ok)
          .map((result) => result.error)
          .filter(Boolean);
        setError(failures.join(" ") || "");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  const stockByProduct = new Map(
    (stock?.products ?? []).map((row) => [row.product_id, row.available])
  );
  const lowStockProducts = products
    .map((product) => ({
      ...product,
      available: stockByProduct.get(product.id) ?? product.stock,
    }))
    .filter((product) => product.available <= LOW_STOCK_LIMIT)
    .sort((a, b) => a.available - b.available);
  const recentOrders = (orders?.orders ?? []).map(toAdminOrderView);
  const pending = orders?.totals.counts.pending ?? 0;

  const stats = [
    { label: "Lifetime revenue", value: orders ? formatPrice(orders.totals.revenue_usd, "USD") : "—" },
    { label: "Orders recorded", value: orders ? String(orders.totals.scanned) : "—" },
    { label: "Awaiting payment", value: orders ? String(pending) : "—" },
    { label: "Available stock", value: stock ? String(stock.totals.available) : "—" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-charcoal)]">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Live order and inventory overview</p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshNonce((value) => value + 1)}
          disabled={loading}
          className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{stat.label}</p>
            <p className="mt-2 text-xl font-extrabold tabular-nums">{loading ? "…" : stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-5">
        <section className="bg-white rounded-xl border overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-bold">Recent orders</h2>
            <Link href="/admin/orders" className="text-xs font-bold text-[var(--color-brand)] hover:underline">
              View all
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase text-gray-400 border-b">
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && !recentOrders.length ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-xs">Loading orders…</td></tr>
                ) : recentOrders.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-xs">No orders yet</td></tr>
                ) : recentOrders.map((order) => (
                  <tr key={order.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-mono text-[11px]">#{order.id.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-xs">{order.buyerName || "—"}</td>
                    <td className="px-4 py-3 text-xs font-bold">{formatPrice(order.amountUsd ?? 0, "USD")}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-gray-100 px-2 py-1 text-[10px] font-bold uppercase">{order.status ?? "pending"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white rounded-xl border overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">Low stock</h2>
              <p className="text-[10px] text-gray-500 mt-0.5">10 units or fewer</p>
            </div>
            <Link href="/admin/inventory" className="text-xs font-bold text-[var(--color-brand)] hover:underline">
              Manage stock
            </Link>
          </div>
          {loading && !stock ? (
            <p className="p-4 text-xs text-gray-400">Loading inventory…</p>
          ) : lowStockProducts.length === 0 ? (
            <p className="p-4 text-xs text-gray-500">No products are at or below the alert level.</p>
          ) : (
            <ul className="divide-y">
              {lowStockProducts.slice(0, 6).map((product) => (
                <li key={product.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`w-2 h-2 rounded-full ${product.available <= 0 ? "bg-red-500" : "bg-amber-500"}`} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{product.name}</span>
                  <span className={`text-xs font-extrabold tabular-nums ${product.available <= 0 ? "text-red-600" : "text-amber-700"}`}>
                    {product.available} left
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
