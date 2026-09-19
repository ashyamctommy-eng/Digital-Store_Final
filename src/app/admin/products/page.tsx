"use client";

import { useMemo, useRef, useState } from "react";
import { products as initialProducts, type Product } from "@/lib/products";
import { categories, getCategory } from "@/lib/categories";
import { formatPrice } from "@/lib/currency";
import { stockLabel } from "@/lib/format";
import { asset } from "@/lib/asset";
import Icon from "@/components/ui/Icon";

const blankForm = {
  name: "",
  category: categories[0].id,
  price_usd: "",
  original_price_usd: "",
  stock: "50",
  country_flags: "🌐",
  description: "",
  specs: "",
  guide_url: "",
  badge: "",
  image: "",
  delivery: "Instant",
};

type FormState = typeof blankForm;

export default function AdminProductsPage() {
  const [list, setList] = useState<Product[]>(initialProducts);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      `${p.name} ${p.category} ${p.id}`.toLowerCase().includes(q)
    );
  }, [list, query]);

  const openNew = () => {
    setForm(blankForm);
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (p: Product) => {
    setForm({
      name: p.name,
      category: p.category,
      price_usd: String(p.price_usd),
      original_price_usd: p.original_price_usd ? String(p.original_price_usd) : "",
      stock: String(p.stock),
      country_flags: p.country_flags,
      description: p.description,
      specs: p.specs.join("\n"),
      guide_url: p.guide_url,
      badge: p.badge ?? "",
      image: p.image,
      delivery: p.delivery ?? "Instant",
    });
    setEditing(p);
    setShowForm(true);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () =>
      setForm((prev) => ({ ...prev, image: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    const name = form.name.trim();
    if (!name) return;

    const next: Product = {
      id: editing?.id ?? `custom-${Date.now()}`,
      slug: editing?.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      name,
      category: form.category,
      country_flags: form.country_flags || "🌐",
      price_usd: parseFloat(form.price_usd) || 0,
      original_price_usd: form.original_price_usd ? parseFloat(form.original_price_usd) : undefined,
      image: form.image || "/assets/images/proxy-logo.svg",
      stock: parseInt(form.stock, 10) || 0,
      description: form.description,
      specs: form.specs
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      guide_url: form.guide_url,
      badge: (form.badge as Product["badge"]) || undefined,
      delivery: form.delivery,
    };

    setList((prev) =>
      editing ? prev.map((p) => (p.id === editing.id ? next : p)) : [next, ...prev]
    );
    setShowForm(false);
  };

  const inputClass =
    "w-full px-3 py-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-page)] text-sm outline-none focus:border-[var(--color-brand)]";
  const labelClass =
    "block text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)] mb-1";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">Products</h1>
          <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">
            {list.length} digital items in the catalog
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Icon
              name="search"
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search catalog"
              className="pl-9 pr-3 py-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-sm outline-none focus:border-[var(--color-brand)] w-full sm:w-56"
            />
          </div>
          <button
            type="button"
            onClick={openNew}
            className="px-4 py-2 rounded-xl bg-[var(--color-brand)] text-white text-xs font-bold uppercase tracking-wider whitespace-nowrap"
          >
            + Add Product
          </button>
        </div>
      </div>

      {/* Honest persistence notice */}
      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10 p-3 flex items-start gap-2">
        <Icon
          name="shield"
          className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5"
        />
        <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
          Edits here are held in memory for this session only. The catalog is
          still a static file (<code>src/lib/products.ts</code>). Move products
          into Firestore to persist changes — see the migration note in the repo
          README.
        </p>
      </div>

      {/* Form modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowForm(false)}
        >
          <div
            className="bg-[var(--color-panel)] w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-extrabold mb-4">
              {editing ? "Edit" : "Add"} Product
            </h2>

            <div className="space-y-3">
              <div>
                <label className={labelClass}>Product name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. USA Facebook Account (Aged / Verified)"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className={inputClass}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Badge</label>
                  <select
                    value={form.badge}
                    onChange={(e) => setForm({ ...form, badge: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">No badge</option>
                    <option value="Best Seller">Best Seller</option>
                    <option value="New Arrival">New Arrival</option>
                    <option value="Hot">Hot</option>
                    <option value="Restocked">Restocked</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Price (USD)</label>
                  <input
                    type="number"
                    value={form.price_usd}
                    onChange={(e) => setForm({ ...form, price_usd: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Was price (USD)</label>
                  <input
                    type="number"
                    value={form.original_price_usd}
                    onChange={(e) =>
                      setForm({ ...form, original_price_usd: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Stock</label>
                  <input
                    type="number"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Country flags</label>
                  <input
                    value={form.country_flags}
                    onChange={(e) =>
                      setForm({ ...form, country_flags: e.target.value })
                    }
                    placeholder="🇺🇸🇬🇧"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Delivery time</label>
                  <input
                    value={form.delivery}
                    onChange={(e) => setForm({ ...form, delivery: e.target.value })}
                    placeholder="Instant"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Image</label>
                <div className="flex gap-2">
                  <input
                    value={form.image}
                    onChange={(e) => setForm({ ...form, image: e.target.value })}
                    placeholder="/assets/images/facebook-3d.svg"
                    className={inputClass}
                  />
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl bg-[var(--color-ink)] text-[var(--color-panel)] text-[10px] font-bold uppercase whitespace-nowrap"
                  >
                    Upload
                  </button>
                </div>
                {form.image && (
                  <div className="mt-2 w-16 h-16 rounded-xl bg-[var(--color-page)] border border-[var(--color-line)] flex items-center justify-center overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset(form.image)}
                      alt="Preview"
                      className="w-full h-full object-contain p-1"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className={labelClass}>Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  rows={2}
                  className={`${inputClass} resize-none`}
                />
              </div>

              <div>
                <label className={labelClass}>
                  Specs — one per line
                </label>
                <textarea
                  value={form.specs}
                  onChange={(e) => setForm({ ...form, specs: e.target.value })}
                  rows={4}
                  placeholder={"Email included\nCookies bundled\n2FA-ready"}
                  className={`${inputClass} resize-none`}
                />
              </div>

              <div>
                <label className={labelClass}>Login guide URL</label>
                <input
                  value={form.guide_url}
                  onChange={(e) => setForm({ ...form, guide_url: e.target.value })}
                  placeholder="https://drive.google.com/…"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-xl border border-[var(--color-line)] text-xs font-bold uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex-1 py-2.5 rounded-xl bg-[var(--color-brand)] text-white text-xs font-bold uppercase tracking-wider"
              >
                {editing ? "Update" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Catalog grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((p) => {
          const cat = getCategory(p.category);
          const stock = stockLabel(p.stock);
          return (
            <div
              key={p.id}
              className="bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)] overflow-hidden"
            >
              <div className="aspect-square bg-[var(--color-page)] flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset(p.image)}
                  alt={p.name}
                  className="w-full h-full object-contain p-4"
                />
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-brand)]">
                    {cat?.name ?? p.category}
                  </span>
                  <span className="text-[13px] leading-none">
                    {p.country_flags}
                  </span>
                </div>
                <h3 className="text-xs font-semibold line-clamp-2 mt-1">
                  {p.name}
                </h3>
                <div className="flex items-center justify-between mt-2">
                  <span className="font-extrabold text-sm tabular-nums">
                    {formatPrice(p.price_usd, "USD")}
                  </span>
                  <span
                    className={`text-[9px] font-bold uppercase ${
                      stock.tone === "out"
                        ? "text-[var(--color-danger)]"
                        : stock.tone === "low"
                          ? "text-[var(--color-warning)]"
                          : "text-[var(--color-success)]"
                    }`}
                  >
                    {p.stock} left
                  </span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="flex-1 py-1.5 rounded-lg border border-[var(--color-line)] text-[10px] font-bold uppercase hover:bg-[var(--color-line)] transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setList((prev) => prev.filter((x) => x.id !== p.id))
                    }
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase text-[var(--color-danger)] border border-[var(--color-danger)]/25 hover:bg-[var(--color-danger)]/10 transition-colors"
                  >
                    Del
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-center py-16 text-sm text-[var(--color-ink-faint)]">
          No products match “{query}”.
        </p>
      )}
    </div>
  );
}
