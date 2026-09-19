"use client";
import { useState, useEffect } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firestore";
import { formatPrice } from "@/lib/currency";

export default function UsersPage() {
  interface CustomerRow {
  id: string;
  name: string;
  email: string;
  orders: number;
  spent: number;
}

const [users, setUsers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc")));
        const map = new Map<string, CustomerRow>();
        snap.docs.forEach(d => { const data = d.data(); if (data.userId && !map.has(data.userId)) map.set(data.userId, { id: data.userId, name: data.userName||"Unknown", email: data.userEmail||"—", orders: 0, spent: 0 }); if (data.userId) { const u = map.get(data.userId)!; u.orders++; u.spent += data.totalAmount||0; }});
        setUsers(Array.from(map.values()));
      } catch (e) { console.error(e); }
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
