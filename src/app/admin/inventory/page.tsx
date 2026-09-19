"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { categories, getCategory } from "@/lib/categories";
import { isSmsProduct, products } from "@/lib/products";
import { formatPrice } from "@/lib/currency";
import Icon from "@/components/ui/Icon";
import {
  adminAddStock,
  adminListStock,
  adminSmsotpStatus,
  getAdminKey,
  parseCredentialLines,
  setAdminKey,
  type InventoryAddResponse,
  type InventoryDryRunResponse,
  type InventoryListResponse,
  type SmsotpStatusResponse,
} from "@/lib/adminApi";

export default function AdminInventoryPage() {
  const [key, setKey] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [authError, setAuthError] = useState("");

  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InventoryAddResponse | null>(null);
  const [dryRun, setDryRun] = useState<InventoryDryRunResponse | null>(null);
  const [error, setError] = useState("");

  const [list, setList] = useState<InventoryListResponse | null>(null);
  const [listError, setListError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [smsProvider, setSmsProvider] = useState<SmsotpStatusResponse | null>(null);

  // Restore the key from this tab's session storage. Reads happen inside an
  // async body because sessionStorage only exists in the browser, so this
  // cannot be a lazy useState initialiser without breaking hydration.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = getAdminKey();
      if (cancelled || !stored) return;
      setKey(stored);
      setUnlocked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the stock summary whenever we unlock or a manual refresh is requested.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    (async () => {
      const [res, provider] = await Promise.all([
        adminListStock(),
        adminSmsotpStatus(),
      ]);
      if (cancelled) return;

      if (provider.ok && provider.data) setSmsProvider(provider.data);

      if (res.ok && res.data) {
        setList(res.data);
        setListError("");
        return;
      }

      setList(null);
      setListError(res.error ?? "Could not load stock.");

      if (res.status === 401 || res.errorCode === "UNAUTHORIZED") {
        setUnlocked(false);
        setAuthError("That admin key was rejected. Check admin_api_key in config.php.");
      }
      if (res.errorCode === "ADMIN_NOT_CONFIGURED") {
        setUnlocked(false);
        setAuthError(
          "No admin key is set on the server yet. Add admin_api_key to server/api/config.php."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unlocked, refreshNonce]);

  const refreshList = useCallback(() => setRefreshNonce((n) => n + 1), []);

  const selectedProduct = products.find((p) => p.id === productId);
  const category = selectedProduct ? getCategory(selectedProduct.category) : undefined;
  const selectedIsSms = selectedProduct ? isSmsProduct(selectedProduct) : false;
  const stockKind = selectedIsSms ? "sms" : "credentials";

  const parsed = useMemo(
    () => parseCredentialLines(text, stockKind),
    [text, stockKind]
  );
  const needsReview = parsed.filter((p) => !p.wellFormed);

  const currentStock = list?.products.find((p) => p.product_id === productId);

  const unlock = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    if (!key.trim()) {
      setAuthError("Enter the admin key.");
      return;
    }
    setAdminKey(key.trim());
    setUnlocked(true);
  };

  const handleSubmit = async () => {
    if (!productId || !text.trim()) return;
    setSubmitting(true);
    setError("");
    setResult(null);

    const res = await adminAddStock(productId, text);
    if (res.ok && res.data) {
      const data = res.data as InventoryAddResponse;
      setResult(data);
      setText("");
      setDryRun(null);
      refreshList();
    } else {
      setError(res.error ?? "Could not add stock.");
    }
    setSubmitting(false);
  };

  const handleDryRun = async () => {
    if (!productId || !text.trim()) return;
    setSubmitting(true);
    setError("");
    setResult(null);
    const res = await adminAddStock(productId, text, true);
    if (res.ok && res.data) {
      setDryRun(res.data as InventoryDryRunResponse);
    } else {
      setError(res.error ?? "Could not preview.");
    }
    setSubmitting(false);
  };

  const inputClass =
    "w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-page)] text-sm outline-none focus:border-[var(--color-brand)]";
  const card = "bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)] p-5";
  const label = "block text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)] mb-1.5";

  /* ---------------------------- Lock screen ---------------------------- */
  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto mt-10">
        <div className={card}>
          <div className="flex items-center gap-2 mb-1">
            <Icon name="shield" className="w-5 h-5 text-[var(--color-brand)]" />
            <h1 className="text-lg font-extrabold">Stock Management</h1>
          </div>
          <p className="text-sm text-[var(--color-ink-soft)] mb-5">
            Enter the admin API key configured in{" "}
            <code>server/api/config.php</code>.
          </p>

          {authError && (
            <p className="mb-4 text-[11px] text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 rounded-xl p-3 leading-relaxed">
              {authError}
            </p>
          )}

          <form onSubmit={unlock} className="space-y-3">
            <div>
              <label className={label}>Admin key</label>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Paste the admin_api_key"
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white text-sm font-bold transition-colors"
            >
              Unlock
            </button>
          </form>

          <p className="mt-4 text-[10px] text-[var(--color-ink-faint)] leading-relaxed">
            The key is kept in this browser tab only and never leaves the site&apos;s
            own API. It is not the same as your sign-in.
          </p>
        </div>
      </div>
    );
  }

  /* ------------------------------ Console ------------------------------ */
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">Stock Management</h1>
          <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">
            Paste credentials in bulk; available counts drive the storefront.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshList}
          className="px-3.5 py-2 rounded-xl border border-[var(--color-line)] text-xs font-bold uppercase tracking-wider hover:border-[var(--color-brand)] transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ---------------------- Bulk uploader ---------------------- */}
        <div className="lg:col-span-2 space-y-5">
          <div className={card}>
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] mb-4">
              Bulk Credential Upload
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>Product</label>
                <select
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    setResult(null);
                    setDryRun(null);
                  }}
                  className={inputClass}
                >
                  {categories.map((cat) => (
                    <optgroup key={cat.id} label={cat.name}>
                      {products
                        .filter((p) => p.category === cat.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                {selectedProduct && (
                  <p className="text-[10px] text-[var(--color-ink-faint)] mt-1.5">
                    {category?.name} · {formatPrice(selectedProduct.price_usd, "USD")} ·
                    available now:{" "}
                    <span className="font-bold text-[var(--color-ink-soft)]">
                      {currentStock ? currentStock.available : "no rows yet"}
                    </span>
                  </p>
                )}
              </div>
              <div className="text-[10px] text-[var(--color-ink-soft)] leading-relaxed sm:pt-6">
                {selectedIsSms ? (
                  <>
                    This is an SMS product, so one{" "}
                    <strong>number per line</strong>:
                    <br />
                    <code className="text-[10px]">PHONE_NUMBER | INBOX_URL_OR_NOTES</code>
                    <br />
                    <code className="text-[10px]">+15551234567 | https://inbox.example/abc</code>
                    <br />
                    Field two is treated as a link when it looks like one and as
                    a plain note otherwise. Include the country code —{" "}
                    <code className="text-[10px]">0712345678</code> is ambiguous.
                  </>
                ) : (
                  <>
                    One credential per line:
                    <br />
                    <code className="text-[10px]">UID|Password|Email</code>
                    <br />
                    <code className="text-[10px]">host:port:user:pass</code>
                  </>
                )}
                <br />
                Blank lines and <code>#</code> comments are ignored.
              </div>
            </div>

            <div className="mt-4">
              <label className={label}>
                {selectedIsSms
                  ? "Numbers — one per line (PHONE_NUMBER | INBOX_URL_OR_NOTES)"
                  : "Credentials — one per line"}
              </label>
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setResult(null);
                  setDryRun(null);
                }}
                rows={10}
                spellCheck={false}
                placeholder={
                  selectedIsSms
                    ? "+15551234567 | https://inbox.example/abc123\n+15559876543 | Keep this page open\n+12545550123"
                    : "acc001|Passw0rd!|mail1@example.com\nacc002|Passw0rd!|mail2@example.com\nhost.example.com:8080:user:pass"
                }
                className={`${inputClass} font-mono text-[11px] resize-y leading-relaxed`}
              />
            </div>

            {/* Live parse preview, mirroring the server parser */}
            {parsed.length > 0 && (
              <div className="mt-3 rounded-xl bg-[var(--color-page)] border border-[var(--color-line)] p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                  <span className="font-bold">
                    {parsed.length} line{parsed.length === 1 ? "" : "s"} parsed
                  </span>
                  {needsReview.length > 0 && (
                    <span className="text-[var(--color-warning)] font-bold">
                      {needsReview.length}{" "}
                      {selectedIsSms ? "missing an inbox link" : "without a UID|Password pair"}
                    </span>
                  )}
                  {selectedIsSms && parsed.some((p) => p.needsReview) && (
                    <span className="text-[var(--color-warning)] font-bold">
                      {parsed.filter((p) => p.needsReview).length} without a country code
                    </span>
                  )}
                </div>
                <ul className="text-[10px] text-[var(--color-ink-faint)] mt-1.5 font-mono break-all space-y-0.5">
                  {parsed.slice(0, 3).map((p, i) => (
                    <li key={`${p.uid}-${i}`}>
                      {selectedIsSms ? (
                        <>
                          {p.phone}
                          {p.inboxUrl ? `  →  ${p.inboxUrl}` : p.notes ? `  →  ${p.notes}` : "  →  (no inbox yet)"}
                        </>
                      ) : (
                        p.uid
                      )}
                    </li>
                  ))}
                  {parsed.length > 3 && <li>+{parsed.length - 3} more</li>}
                </ul>
              </div>
            )}

            {error && (
              <p className="mt-3 text-[11px] text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 rounded-xl p-3 leading-relaxed">
                {error}
              </p>
            )}

            {result && (
              <p className="mt-3 text-[11px] text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/25 rounded-xl p-3 leading-relaxed">
                Added <strong>{result.added}</strong> unit
                {result.added === 1 ? "" : "s"}
                {result.duplicates > 0 && `, skipped ${result.duplicates} duplicate`}
                {result.duplicates > 0 && result.duplicates === 1 ? "" : ""}. Available
                stock for this product is now{" "}
                <strong>{result.available}</strong>.
              </p>
            )}

            {dryRun && (
              <div className="mt-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/25 p-3">
                <p className="text-[11px] font-bold text-blue-700 dark:text-blue-300">
                  Preview — {dryRun.parsed} line
                  {dryRun.parsed === 1 ? "" : "s"} would be added. Nothing saved.
                </p>
                <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-blue-800 dark:text-blue-200 break-all">
                  {dryRun.preview.map((p, i) => (
                    <li key={`${p.uid}-${i}`}>
                      {p.uid} | {p.secret}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-4">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !text.trim() || !productId}
                className="flex-1 min-w-[160px] py-3 rounded-xl bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white text-sm font-bold disabled:opacity-50 transition-colors"
              >
                {submitting ? "Saving…" : `Add ${parsed.length || ""} to stock`.trim()}
              </button>
              <button
                type="button"
                onClick={handleDryRun}
                disabled={submitting || !text.trim() || !productId}
                className="px-4 py-3 rounded-xl border border-[var(--color-line)] text-xs font-bold uppercase tracking-wider hover:border-[var(--color-brand)] disabled:opacity-50 transition-colors"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => {
                  setText("");
                  setResult(null);
                  setDryRun(null);
                  setError("");
                }}
                className="px-4 py-3 rounded-xl border border-[var(--color-line)] text-xs font-bold uppercase tracking-wider hover:border-[var(--color-ink-soft)] transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* ------------------------ Stock summary ------------------------ */}
        <div className="space-y-5">
          <div className={card}>
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] mb-4">
              Inventory
            </h2>

            {listError ? (
              <p className="text-[11px] text-[var(--color-warning)] leading-relaxed">
                {listError}
              </p>
            ) : !list ? (
              <p className="text-sm text-[var(--color-ink-faint)] animate-pulse">
                Loading…
              </p>
            ) : list.products.length === 0 ? (
              <p className="text-[11px] text-[var(--color-ink-faint)] leading-relaxed">
                No stock uploaded yet. Products keep their catalog stock numbers
                until the first upload.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[
                    { label: "Products", value: list.totals.products },
                    { label: "Available", value: list.totals.available },
                    { label: "Sold", value: list.totals.sold },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-xl bg-[var(--color-page)] p-2.5 text-center"
                    >
                      <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
                        {s.label}
                      </p>
                      <p className="text-base font-extrabold tabular-nums">
                        {s.value}
                      </p>
                    </div>
                  ))}
                </div>

                <ul className="space-y-2">
                  {list.products.map((row) => {
                    const product = products.find((p) => p.id === row.product_id);
                    return (
                      <li
                        key={row.product_id}
                        className={`rounded-xl border p-3 transition-colors cursor-pointer ${
                          row.product_id === productId
                            ? "border-[var(--color-brand)] bg-[var(--color-brand)]/5"
                            : "border-[var(--color-line)] hover:border-[var(--color-ink-faint)]"
                        }`}
                        onClick={() => setProductId(row.product_id)}
                      >
                        <p className="text-xs font-semibold line-clamp-2">
                          {product?.name ?? row.product_id}
                        </p>
                        <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                          <span className="font-bold text-[var(--color-success)]">
                            {row.available} available
                          </span>
                          <span className="text-[var(--color-ink-faint)]">
                            {row.sold} sold
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          {/* On-demand SMS provider */}
          <div className={card}>
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] mb-4">
              On-Demand SMS Provider
            </h2>

            {!smsProvider ? (
              <p className="text-sm text-[var(--color-ink-faint)] animate-pulse">
                Checking…
              </p>
            ) : !smsProvider.configured ? (
              <p className="text-[11px] text-[var(--color-ink-soft)] leading-relaxed">
                Not configured. SMS products are fulfilled from pre-bought stock
                only. Add <code>smsotp.api_key</code> to{" "}
                <code>server/api/config.php</code> to enable buying numbers on
                demand when stock runs out.
              </p>
            ) : (
              <>
                <div className="rounded-xl bg-[var(--color-page)] p-3 mb-3">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
                    Balance
                  </p>
                  <p className="text-xl font-extrabold tabular-nums mt-0.5">
                    ${smsProvider.balance.toFixed(2)}
                  </p>
                  <p
                    className={`text-[10px] font-bold mt-1 ${
                      smsProvider.balance_ok
                        ? "text-[var(--color-success)]"
                        : "text-[var(--color-danger)]"
                    }`}
                  >
                    {smsProvider.balance_ok
                      ? "On-demand fallback is active"
                      : smsProvider.balance_error || "Balance unavailable"}
                  </p>
                </div>

                <ul className="text-[10px] text-[var(--color-ink-soft)] space-y-1 leading-relaxed">
                  <li>
                    {smsProvider.sms_products} SMS product
                    {smsProvider.sms_products === 1 ? "" : "s"} can be bought on
                    demand when pre-bought stock is empty.
                  </li>
                  {Object.keys(smsProvider.missing_service_ids).length > 0 && (
                    <li className="text-[var(--color-warning)] font-bold">
                      Unknown service codes:{" "}
                      {Object.entries(smsProvider.missing_service_ids)
                        .map(([pid, code]) => `${pid} (${code})`)
                        .join(", ")}
                    </li>
                  )}
                  {smsProvider.services.length > 0 && (
                    <li>
                      Provider knows {smsProvider.services.length} services,
                      including{" "}
                      {smsProvider.services
                        .slice(0, 4)
                        .map((s) => s.id)
                        .join(", ")}
                      .
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-page)] p-4">
            <p className="text-[11px] text-[var(--color-ink-soft)] leading-relaxed">
              Adding stock here immediately changes the public count on the
              storefront. When a payment settles, the server claims exactly the
              number of units purchased, binds them to the order and emails them
              to the buyer. A product with no uploaded rows keeps its catalog
              number, so nothing can accidentally sell out.
              <br />
              <br />
              SMS products prefer pre-bought numbers. Only when those run out,
              and only when the provider balance is above the minimum, is a
              number bought on demand — and never before the order is paid.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
