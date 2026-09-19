"use client";

import { useState, useEffect } from "react";
import { adminListOrders } from "@/lib/adminApi";
import { formatPrice } from "@/lib/currency";

interface CustomerRow {
  id: string;
  name: string;
  email: string;
  orders: number;
  spent: number;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);

  /*
   * Grouped from the real ledger, through the admin API.
   *
   * Keyed on the buyer's email rather than a user id: most purchases are made
   * without signing in, so an email is all the store actually knows about a
   * customer. Ordering by a user id meant guests were dropped entirely.
   *
   * "Spent" counts orders that reached paid or delivered — pending and failed
   * orders are not revenue.
   */
  useEffect(() => {
    async function load() {
      const res = await adminListOrders({ limit: 1000 });
      if (res.ok && res.data) {
        const map = new Map<string, CustomerRow>();
        for (const order of res.data.orders) {
          const email = (order.buyer_email ?? "").trim().toLowerCase();
          const key = email || "unknown";

          if (!map.has(key)) {
            map.set(key, {
              id: key,
              name: (order.buyer_name as string) || "—",
              email: email || "—",
              orders: 0,
              spent: 0,
            });
          }

          const row = map.get(key)!;
          row.orders += 1;
          if (order.status === "paid" || order.status === "delivered") {
            row.spent += Number(order.amount_usd ?? 0);
          }
        }
        setUsers(Array.from(map.values()).sort((a, b) => b.spent - a.spent));
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Users</h1>
      <p className="text-sm text-gray-500 mb-6">{users.length} customers</p>
      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] font-bold uppercase text-gray-400 border-b bg-gray-50"><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Email</th><th className="px-5 py-3">Orders</th><th className="px-5 py-3">Total Spent</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-400 text-xs">Loading...</td></tr> :
             users.length===0 ? <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-400 text-xs">No users yet</td></tr> :
             users.map(u=>(
              <tr key={u.id} className="border-b hover:bg-gray-50/50">
                <td className="px-5 py-3 flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-[var(--color-charcoal)] text-white flex items-center justify-center text-xs font-bold">{u.name.charAt(0)}</div><span className="text-xs font-medium">{u.name}</span></td>
                <td className="px-5 py-3 text-xs text-gray-600">{u.email}</td>
                <td className="px-5 py-3 text-xs font-bold">{u.orders}</td>
                <td className="px-5 py-3 text-xs font-bold text-green-700">{formatPrice(u.spent, "USD")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
