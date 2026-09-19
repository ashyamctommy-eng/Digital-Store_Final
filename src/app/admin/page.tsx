"use client";

import { useState, useEffect } from "react";
import { formatPrice } from "@/lib/currency";
import { adminListOrders } from "@/lib/adminApi";
import { toAdminOrderView, type AdminOrderView } from "@/lib/adminOrders";

export default function AdminDashboard() {
  const [stats, setStats] = useState([
    { label: "Revenue", value: "—", color: "text-green-600 bg-green-50", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    { label: "Total Orders", value: "0", color: "text-blue-600 bg-blue-50", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { label: "Customers", value: "—", color: "text-purple-600 bg-purple-50", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
    { label: "Awaiting Delivery", value: "0", color: "text-amber-600 bg-amber-50", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  ]);
  const [recentOrders, setRecentOrders] = useState<AdminOrderView[]>([]);
  const [loading, setLoading] = useState(true);

  // Reads the real ledger through the admin API, not a browser-written copy:
  // the revenue and order figures have to come from the same records that
  // fulfilment acted on.
  useEffect(() => {
    async function load() {
      const res = await adminListOrders({ limit: 10 });
      if (!res.ok || !res.data) {
        setLoading(false);
        return;
      }
      const rows = res.data.orders.map(toAdminOrderView);
      setRecentOrders(rows);
      const pending = res.data.totals.counts.pending ?? 0;
      setStats((p) => [
        { ...p[0], value: formatPrice(res.data!.totals.revenue_usd, "USD") },
        { ...p[1], value: `${res.data!.totals.scanned}` },
        p[2],
        { ...p[3], value: `${pending}` },
      ]);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div>
      <div className="mb-6"><h1 className="text-2xl font-bold text-[var(--color-charcoal)]">Dashboard</h1><p className="text-sm text-gray-500 mt-1">Store overview</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-lg border p-4 sm:p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">{s.label}</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.color}`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={s.icon} /></svg></div>
            </div>
            <p className="text-xl sm:text-2xl font-bold text-[var(--color-charcoal)]">{loading ? "..." : s.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg border">
        <div className="px-5 py-4 border-b flex items-center justify-between"><h2 className="font-bold text-sm uppercase tracking-wider">Recent Orders</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] font-bold uppercase text-gray-400 border-b"><th className="px-4 py-3">ID</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-xs">Loading...</td></tr> :
               recentOrders.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-xs">No orders yet</td></tr> :
               recentOrders.map((o) => (
                <tr key={o.id} className="border-b hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-[11px]">#{o.id.slice(0,8)}</td>
                  <td className="px-4 py-3 text-xs">{o.buyerName || "—"}</td>
                  <td className="px-4 py-3 text-xs font-bold">{formatPrice(o.amountUsd ?? 0, "USD")}</td>
                  <td className="px-4 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100">{o.gateway ?? "—"}</span></td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded ${o.status==="paid"||o.status==="delivered"?"bg-green-100 text-green-700":o.status==="failed"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-700"}`}>{o.status ?? "pending"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
