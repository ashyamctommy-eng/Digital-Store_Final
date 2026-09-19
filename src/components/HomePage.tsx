"use client";

import Link from "next/link";
import NoticeSlider from "./NoticeSlider";
import SearchFilterBar from "./SearchFilterBar";
import CategorySection from "./CategorySection";
import ProductGrid from "./ProductGrid";
import Icon from "./ui/Icon";
import { useCatalog } from "@/context/CatalogContext";
import { categories, getCategory } from "@/lib/categories";
import { products as allProducts } from "@/lib/products";
import { DELIVERY, SUPPORT } from "@/lib/config";

/**
 * Storefront body. Shows the full category browse experience by default and
 * switches to a flat, filtered results view as soon as the visitor searches or
 * taps a tag / "See more".
 */
export default function HomePage() {
  const { isFiltering, results, query, category, tag, featured, reset } = useCatalog();

  const activeCategory = category ? getCategory(category) : null;

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 pb-4">
      {/* Announcements */}
      <NoticeSlider className="pt-4" />

      {/* Quick filters */}
      <SearchFilterBar className="mt-4" />

      {isFiltering ? (
        /* ----------------------- Filtered results ----------------------- */
        <section className="mt-6 animate-fade-up">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-extrabold truncate">
                {activeCategory
                  ? activeCategory.name
                  : query
                    ? `Results for “${query}”`
                    : tag
                      ? tag
                      : "All products"}
              </h1>
              <p className="text-xs text-[var(--color-ink-soft)] mt-0.5">
                {activeCategory?.tagline ??
                  "Verified stock, delivered the moment you pay."}
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="shrink-0 text-xs font-bold text-[var(--color-brand)] hover:underline"
            >
              Browse all
            </button>
          </div>

          <ProductGrid products={results} />

          {results.length > 0 && (
            <p className="text-center text-xs text-[var(--color-ink-faint)] mt-8">
              Not seeing what you need?{" "}
              <a
                href={`https://wa.me/${SUPPORT.whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-[var(--color-brand)] hover:underline"
              >
                Request a custom item
              </a>
            </p>
          )}
        </section>
      ) : (
        /* ------------------------ Browse experience ---------------------- */
        <>
          {/* Hero */}
          <section className="mt-6 rounded-2xl bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-brand-strong)] text-white p-5 sm:p-8 shadow-sm overflow-hidden relative">
            <div className="absolute -right-10 -bottom-12 text-[8rem] opacity-10 select-none">
              🛒
            </div>
            <div className="relative max-w-lg">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] bg-white/20 backdrop-blur px-3 py-1 rounded-full">
                <Icon name="bolt" className="w-3 h-3" />
                {DELIVERY.promise}
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight mt-3">
                Buy accounts, verifications, VPNs &amp; proxies
              </h1>
              <p className="text-sm text-white/85 mt-2 leading-relaxed">
                {DELIVERY.detail} {DELIVERY.guarantee}
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                {["🇺🇸 USA", "🇬🇧 UK", "🇨🇦 CA", "🇩🇪 DE", "🇳🇬 NG"].map((f) => (
                  <span
                    key={f}
                    className="text-[11px] font-bold bg-white/15 backdrop-blur px-2.5 py-1 rounded-full"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* Featured rail */}
          {featured.length > 0 && (
            <section className="mt-8">
              <div className="flex items-end justify-between mb-3">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[var(--color-brand)]">
                    Hand-picked
                  </p>
                  <h2 className="text-lg font-extrabold">Trending Right Now</h2>
                </div>
                <Link
                  href="#all-categories"
                  className="text-xs font-bold text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors"
                >
                  See all
                </Link>
              </div>
              <ProductGrid products={featured.slice(0, 4)} />
            </section>
          )}

          {/* Category sections */}
          <div id="all-categories" className="mt-10 space-y-10">
            {categories.map((cat) => {
              const list = allProducts.filter((p) => p.category === cat.id);
              return (
                <CategorySection key={cat.id} category={cat} products={list} />
              );
            })}
          </div>

          {/* Support CTA */}
          <section className="mt-10 rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-[var(--color-brand)]/10 text-[var(--color-brand)] flex items-center justify-center flex-shrink-0">
                <Icon name="headset" className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h2 className="font-extrabold">Can&apos;t find what you need?</h2>
                <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">
                  Bulk orders, custom regions and niche platforms — we source on
                  request.
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <a
                  href={`https://wa.me/${SUPPORT.whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#1da851] text-white text-xs font-bold transition-colors"
                >
                  <Icon name="whatsapp" className="w-4 h-4" />
                  WhatsApp
                </a>
                <a
                  href={SUPPORT.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#229ED9] hover:bg-[#1d8cbf] text-white text-xs font-bold transition-colors"
                >
                  <Icon name="telegram" className="w-4 h-4" />
                  Telegram
                </a>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
