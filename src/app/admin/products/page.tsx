"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { products as initialProducts, type Product } from "@/lib/products";
import { categories, getCategory } from "@/lib/categories";
import { formatPrice } from "@/lib/currency";
import { stockLabel } from "@/lib/format";
import { asset } from "@/lib/asset";
import Icon from "@/components/ui/Icon";
import {
  adminListCatalog,
  adminListStock,
  adminGenerateProductDescription,
  adminSaveCatalogProduct,
  adminSetCatalogActive,
  type InventoryListResponse,
} from "@/lib/adminApi";

const blankForm = {
  id: "",
  slug: "",
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
  delivery_kind: "credentials" as Product["delivery_kind"],
  proxy_per_unit: "1",
  proxy_label: "Proxy access",
  proxy_pool_type: "res",
  proxy_country: "any",
  proxy_protocol: "http",
  proxy_data_gb: "",
  sms_service_id: "",
  sms_country_id: "",
  sms_server_id: "1",
  sms_label: "",
};

type FormState = typeof blankForm;

export default function AdminProductsPage() {
  const [list, setList] = useState<Product[]>(initialProducts);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [inventory, setInventory] = useState<InventoryListResponse | null>(null);
  const [inventoryError, setInventoryError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [formError, setFormError] = useState("");
  const [descriptionError, setDescriptionError] = useState("");
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [refreshStock, setRefreshStock] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([adminListStock(), adminListCatalog()]).then(([stockRes, catalogRes]) => {
      if (cancelled) return;
      if (stockRes.ok && stockRes.data) {
        setInventory(stockRes.data);
        setInventoryError("");
      } else {
        setInventoryError(stockRes.error ?? "Live stock is unavailable. Showing catalog estimates.");
      }
      if (catalogRes.ok && catalogRes.data) {
        setList(catalogRes.data.products);
        setCatalogError("");
        setLastRefresh(Date.now());
      } else {
        setCatalogError(catalogRes.error ?? "Could not load the saved catalog.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refreshStock]);

  const stockByProduct = useMemo(
    () => new Map((inventory?.products ?? []).map((row) => [row.product_id, row.available])),
    [inventory]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((p) => {
      const matchesQuery = !q || `${p.name} ${p.category} ${p.id}`.toLowerCase().includes(q);
      const available = p.delivery_kind === "proxy" ? 0 : stockByProduct.get(p.id) ?? p.stock;
      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "low" && available > 0 && available <= 10) ||
        (stockFilter === "out" && available <= 0);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && p.active !== false) ||
        (statusFilter === "inactive" && p.active === false);
      return matchesQuery && matchesStock && matchesStatus;
    });
  }, [list, query, stockByProduct, stockFilter, statusFilter]);

  const openNew = () => {
    setForm(blankForm);
    setEditing(null);
    setFormError("");
    setDescriptionError("");
    setShowForm(true);
  };

  const openEdit = (p: Product) => {
    setForm({
      id: p.id,
      slug: p.slug,
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
      delivery_kind: p.delivery_kind ?? "credentials",
      proxy_per_unit: String(p.proxy?.per_unit ?? 1),
      proxy_label: p.proxy?.label ?? "Proxy access",
      proxy_pool_type: p.proxy?.pool_type ?? "res",
      proxy_country: p.proxy?.country ?? "any",
      proxy_protocol: p.proxy?.protocol ?? "http",
      proxy_data_gb: p.proxy?.data_gb === undefined ? "" : String(p.proxy.data_gb),
      sms_service_id: p.sms?.service_id ?? "",
      sms_country_id: p.sms?.country_id ?? "",
      sms_server_id: p.sms?.server_id ?? "1",
      sms_label: p.sms?.label ?? "",
    });
    setEditing(p);
    setFormError("");
    setDescriptionError("");
    setShowForm(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    const id = form.id.trim() || `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    const slug = form.slug.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!name || !form.price_usd || !form.image) {
      setFormError("Enter a name, price and image path or URL.");
      return;
    }

    const next: Product = {
      id,
      slug,
      name,
      category: form.category,
      country_flags: form.country_flags || "🌐",
      price_usd: parseFloat(form.price_usd),
      original_price_usd: form.original_price_usd ? parseFloat(form.original_price_usd) : undefined,
      image: form.image,
      stock: form.delivery_kind === "proxy" ? 0 : parseInt(form.stock, 10),
      description: form.description,
      specs: form.specs
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      guide_url: form.guide_url,
      badge: (form.badge as Product["badge"]) || undefined,
      delivery: form.delivery,
      delivery_kind: form.delivery_kind ?? "credentials",
      ...(form.delivery_kind === "proxy"
        ? {
            proxy: {
              per_unit: parseInt(form.proxy_per_unit, 10),
              label: form.proxy_label,
              pool_type: form.proxy_pool_type as "res" | "mob" | "dc",
              country: form.proxy_country.toLowerCase(),
              protocol: form.proxy_protocol as "http" | "https" | "socks4" | "socks5",
              ...(form.proxy_data_gb ? { data_gb: parseFloat(form.proxy_data_gb) } : {}),
            },
          }
        : {}),
      ...(form.delivery_kind === "sms"
        ? {
            sms: {
              service_id: form.sms_service_id,
              country_id: form.sms_country_id,
              server_id: form.sms_server_id,
              label: form.sms_label || name,
            },
          }
        : {}),
    };
    setSaving(true);
    setFormError("");
    const res = await adminSaveCatalogProduct(next);
    setSaving(false);
    if (!res.ok || !res.data) {
      setFormError(res.error ?? "Could not save this product.");
      return;
    }
    setList(res.data.products);
    setLastRefresh(Date.now());
    setShowForm(false);
  };

  const handleGenerateDescription = async () => {
    if (!form.name.trim()) {
      setDescriptionError("Enter a product name before generating a draft.");
      return;
    }

    setGeneratingDescription(true);
    setDescriptionError("");
    try {
      const res = await adminGenerateProductDescription({
        name: form.name.trim(),
        category: getCategory(form.category)?.name ?? form.category,
        description: form.description,
        specs: form.specs
          .split("\n")
          .map((spec) => spec.trim())
          .filter(Boolean),
      });
      if (!res.ok || !res.data) {
        const message = res.error === "Could not reach the payment API."
          ? "Could not reach the store API."
          : res.error;
        setDescriptionError(message ?? "Could not generate a description.");
        return;
      }
      setForm((current) => ({ ...current, description: res.data!.description }));
    } catch {
      setDescriptionError("Could not reach Novita. Your product was not changed.");
    } finally {
      setGeneratingDescription(false);
    }
  };

  const handleSetActive = async (product: Product) => {
    const nextActive = product.active === false;
    const res = await adminSetCatalogActive(product.id, nextActive);
    if (!res.ok || !res.data) {
      setCatalogError(res.error ?? "Could not update product visibility.");
      return;
    }
    setList(res.data.products);
    setLastRefresh(Date.now());
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
            {list.length} catalog items
            {inventory ? ` · ${inventory.totals.available} uploaded units available` : ""}
            {lastRefresh ? ` · saved ${new Date(lastRefresh).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <select
            value={stockFilter}
            onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)}
            aria-label="Filter products by stock"
            className="px-3 py-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-xs"
          >
            <option value="all">All stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            aria-label="Filter products by visibility"
            className="px-3 py-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-xs"
          >
            <option value="all">All products</option>
            <option value="active">Live</option>
            <option value="inactive">Hidden</option>
          </select>
          <button
            type="button"
            onClick={() => setRefreshStock((value) => value + 1)}
            className="px-3 py-2 rounded-xl border border-[var(--color-line)] text-xs font-bold"
          >
            Refresh stock
          </button>
          <Link
            href="/admin/inventory"
            className="px-4 py-2 rounded-xl bg-[var(--color-brand)] text-white text-xs font-bold uppercase tracking-wider whitespace-nowrap"
          >
            Manage stock
          </Link>
          <button
            type="button"
            onClick={openNew}
            className="px-4 py-2 rounded-xl bg-[var(--color-brand)] text-white text-xs font-bold whitespace-nowrap"
          >
            + Add Product
          </button>
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
        <p className="text-[11px] text-[var(--color-ink-soft)] leading-relaxed">
          Saved product changes appear in the storefront without rebuilding. Removing a product hides it from new sales but keeps its catalog record for existing orders. Inventory is managed separately.
        </p>
      </div>
      {catalogError && (
        <p className="mb-4 text-[11px] text-[var(--color-warning)]">{catalogError}</p>
      )}
      {inventoryError && (
        <p className="mb-4 text-[11px] text-[var(--color-warning)]">{inventoryError}</p>
      )}

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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Product ID</label>
                  <input
                    value={form.id}
                    onChange={(e) => setForm({ ...form, id: e.target.value })}
                    disabled={!!editing}
                    placeholder="unique-product-id"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>URL slug</label>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    placeholder="product-name"
                    className={inputClass}
                  />
                </div>
              </div>
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

              <div>
                <label className={labelClass}>Delivery type</label>
                <select
                  value={form.delivery_kind ?? "credentials"}
                  onChange={(e) => setForm({ ...form, delivery_kind: e.target.value as Product["delivery_kind"] })}
                  className={inputClass}
                >
                  <option value="credentials">Uploaded credentials</option>
                  <option value="sms">SMS number</option>
                  <option value="proxy">Proxy service</option>
                </select>
              </div>
              {form.delivery_kind === "proxy" && (
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--color-line)] p-3">
                  <div>
                    <label className={labelClass}>Credentials per unit</label>
                    <input
                      type="number"
                      min="1"
                      value={form.proxy_per_unit}
                      onChange={(e) => setForm({ ...form, proxy_per_unit: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Proxy label</label>
                    <input
                      value={form.proxy_label}
                      onChange={(e) => setForm({ ...form, proxy_label: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Pool type</label>
                    <select
                      value={form.proxy_pool_type}
                      onChange={(e) => setForm({ ...form, proxy_pool_type: e.target.value })}
                      className={inputClass}
                    >
                      <option value="res">Residential</option>
                      <option value="mob">Mobile</option>
                      <option value="dc">Datacenter</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Country code or any</label>
                    <input
                      value={form.proxy_country}
                      onChange={(e) => setForm({ ...form, proxy_country: e.target.value })}
                      placeholder="us"
                      maxLength={3}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Protocol</label>
                    <select
                      value={form.proxy_protocol}
                      onChange={(e) => setForm({ ...form, proxy_protocol: e.target.value })}
                      className={inputClass}
                    >
                      <option value="http">HTTP</option>
                      <option value="https">HTTPS</option>
                      <option value="socks4">SOCKS4</option>
                      <option value="socks5">SOCKS5</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Bandwidth per unit (GB)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.proxy_data_gb}
                      onChange={(e) => setForm({ ...form, proxy_data_gb: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}
              {form.delivery_kind === "sms" && (
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--color-line)] p-3">
                  <div>
                    <label className={labelClass}>SMS service ID</label>
                    <input value={form.sms_service_id} onChange={(e) => setForm({ ...form, sms_service_id: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Country ID</label>
                    <input value={form.sms_country_id} onChange={(e) => setForm({ ...form, sms_country_id: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Server ID</label>
                    <input value={form.sms_server_id} onChange={(e) => setForm({ ...form, sms_server_id: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Service label</label>
                    <input value={form.sms_label} onChange={(e) => setForm({ ...form, sms_label: e.target.value })} className={inputClass} />
                  </div>
                </div>
              )}

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
                    value={form.delivery_kind === "proxy" ? "0" : form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    disabled={form.delivery_kind === "proxy"}
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
                <input
                  value={form.image}
                  onChange={(e) => setForm({ ...form, image: e.target.value })}
                  placeholder="/assets/images/facebook-3d.svg or https://…"
                  className={inputClass}
                />
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
                <div className="flex items-center justify-between gap-3">
                  <label className={labelClass}>Description</label>
                  <button
                    type="button"
                    onClick={() => void handleGenerateDescription()}
                    disabled={generatingDescription}
                    className="mb-1 rounded-lg border border-[var(--color-brand)]/30 px-2.5 py-1.5 text-[10px] font-bold text-[var(--color-brand)] hover:bg-[var(--color-brand)]/10 disabled:opacity-50"
                  >
                    {generatingDescription ? "Generating…" : "Draft with Novita"}
                  </button>
                </div>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  rows={2}
                  className={`${inputClass} resize-none`}
                />
                <p className="mt-1 text-[10px] text-[var(--color-ink-faint)]">
                  Draft only. Review accuracy before saving the product.
                </p>
                {descriptionError && (
                  <p role="alert" className="mt-1 text-[11px] text-[var(--color-danger)]">
                    {descriptionError}
                  </p>
                )}
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

            {formError && (
              <p className="mt-3 text-xs text-[var(--color-danger)]">{formError}</p>
            )}
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
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-[var(--color-brand)] text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50"
              >
                {saving ? "Saving…" : editing ? "Save changes" : "Create product"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Catalog grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((p) => {
          const cat = getCategory(p.category);
          const available = p.delivery_kind === "proxy" ? 0 : stockByProduct.get(p.id) ?? p.stock;
          const stock = stockLabel(available);
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
                {p.active === false && (
                  <p className="mt-1 text-[9px] font-bold uppercase text-[var(--color-danger)]">Hidden from storefront</p>
                )}
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
                    {available} left
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
                    onClick={() => void handleSetActive(p)}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase text-[var(--color-danger)] border border-[var(--color-danger)]/25 hover:bg-[var(--color-danger)]/10 transition-colors"
                  >
                    {p.active === false ? "Restore" : "Hide"}
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
