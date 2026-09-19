"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  getProductBySlug,
  products as allProducts,
  type Product,
} from "@/lib/products";
import { getCategory } from "@/lib/categories";
import { useCart } from "@/context/CartContext";
import { asset } from "@/lib/asset";
import { discountPercent, formatPrice, splitFlags, stockLabel } from "@/lib/format";
import { DELIVERY, SUPPORT } from "@/lib/config";
import Icon from "@/components/ui/Icon";

export default function ProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const product = slug ? getProductBySlug(slug) : undefined;

  const { addToCart, setIsCartOpen } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const related = useMemo<Product[]>(() => {
    if (!product) return [];
    return allProducts
      .filter((p) => p.category === product.category && p.id !== product.id)
      .slice(0, 4);
  }, [product]);

  if (!product) {
    return (
      <div className="min-h-[70dvh] flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-4xl mb-3">🔍</p>
          <h1 className="text-xl font-extrabold">Product not found</h1>
          <p className="text-sm text-[var(--color-ink-soft)] mt-1">
            This item may have been sold out or renamed.
          </p>
          <Link
            href="/"
            className="inline-block mt-5 px-6 py-3 rounded-xl bg-[var(--color-brand)] text-white text-xs font-bold uppercase tracking-wider"
          >
            Back to Store
          </Link>
        </div>
      </div>
    );
  }

  const category = getCategory(product.category);
  const off = discountPercent(product.price, product.original_price);
  const stock = stockLabel(product.stock);
  const soldOut = product.stock <= 0;
  const total = product.price * quantity;

  const handleBuyNow = () => {
    addToCart(
      {
        id: product.id,
        slug: product.slug,
        name: product.name,
        category: category?.name ?? product.category,
        price: product.price,
        image: product.image,
      },
      quantity
    );
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  return (
    <div className="pb-28 lg:pb-0">
      {/* Breadcrumb */}
      <nav className="max-w-6xl mx-auto px-4 pt-4 text-[11px] text-[var(--color-ink-soft)] flex items-center gap-1.5 flex-wrap">
        <Link href="/" className="hover:text-[var(--color-brand)]">
          Home
        </Link>
        <Icon name="chevronRight" className="w-3 h-3" />
        {category && (
          <>
            <Link
              href="/"
              className="hover:text-[var(--color-brand)]"
            >
              {category.name}
            </Link>
            <Icon name="chevronRight" className="w-3 h-3" />
          </>
        )}
        <span className="text-[var(--color-ink)] font-semibold truncate max-w-[60%]">
          {product.name}
        </span>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-5 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-12">
        {/* ------------------------- Visual ------------------------- */}
        <div>
          <div className="relative aspect-square rounded-2xl bg-gradient-to-br from-[var(--color-line)] to-[var(--color-panel)] border border-[var(--color-line)] overflow-hidden shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset(product.image)}
              alt={product.name}
              className="w-full h-full object-contain p-10"
            />

            <div className="absolute top-3 left-3 flex flex-col gap-1.5">
              {product.badge && (
                <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[var(--color-brand)] text-white shadow-sm">
                  {product.badge}
                </span>
              )}
              {off !== null && (
                <span className="text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full bg-[var(--color-ink)] text-[var(--color-panel)]">
                  Save {off}%
                </span>
              )}
            </div>
          </div>

          {/* Trust strip */}
          <div className="grid grid-cols-3 gap-2 mt-3">
            {[
              { icon: "bolt" as const, label: product.delivery ?? "Instant" },
              { icon: "shield" as const, label: "24h Replacement" },
              { icon: "headset" as const, label: "1h Support" },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-[var(--color-line)] p-2.5 text-center"
              >
                <Icon
                  name={item.icon}
                  className="w-4 h-4 mx-auto text-[var(--color-brand)]"
                />
                <p className="text-[9px] font-bold uppercase tracking-wider mt-1 text-[var(--color-ink-soft)]">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* -------------------------- Info -------------------------- */}
        <div className="flex flex-col">
          {/* Category + availability */}
          <div className="flex items-center gap-2 flex-wrap">
            {category && (
              <Link
                href="/"
                className="text-[10px] font-extrabold uppercase tracking-[0.15em] px-2.5 py-1 rounded-full bg-[var(--color-blue)]/10 text-[var(--color-blue)] hover:bg-[var(--color-blue)]/20 transition-colors"
              >
                {category.name}
              </Link>
            )}
            <span
              className={`text-[10px] font-extrabold uppercase tracking-[0.15em] px-2.5 py-1 rounded-full ${
                stock.tone === "out"
                  ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                  : stock.tone === "low"
                    ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                    : "bg-[var(--color-success)]/10 text-[var(--color-success)]"
              }`}
            >
              {stock.text}
            </span>
          </div>

          {/* Title */}
          <h1 className="text-xl sm:text-2xl font-extrabold leading-tight mt-3">
            {product.name}
          </h1>

          {/* Flag pills */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
              Regions
            </span>
            {splitFlags(product.country_flags).map((flag, i) => (
              <span
                key={`${flag}-${i}`}
                className="px-2.5 py-1 rounded-full bg-[var(--color-line)] text-sm leading-none"
              >
                {flag}
              </span>
            ))}
          </div>

          {/* Price */}
          <div className="flex items-baseline gap-2.5 mt-4 flex-wrap">
            <span className="text-3xl font-extrabold text-[var(--color-brand)] tabular-nums">
              {formatPrice(product.price)}
            </span>
            {product.original_price && (
              <span className="text-base text-[var(--color-ink-faint)] line-through tabular-nums">
                {formatPrice(product.original_price)}
              </span>
            )}
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
              {product.currency}
            </span>
          </div>

          {/* Description */}
          <p className="text-sm text-[var(--color-ink-soft)] mt-3 leading-relaxed">
            {product.description}
          </p>

          {/* Specs */}
          <div className="mt-5 rounded-2xl border border-[var(--color-line)] p-4">
            <h2 className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[var(--color-ink-faint)] mb-3">
              What you get
            </h2>
            <ul className="space-y-2">
              {product.specs.map((spec) => (
                <li key={spec} className="flex items-start gap-2.5 text-sm">
                  <span className="w-4 h-4 rounded-full bg-[var(--color-success)]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon
                      name="check"
                      className="w-2.5 h-2.5 text-[var(--color-success)]"
                    />
                  </span>
                  <span className="text-[var(--color-ink-soft)] leading-snug">
                    {spec}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Guide */}
          <div className="mt-3">
            {product.guide_url ? (
              <a
                href={product.guide_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-xl border border-[var(--color-line)] p-3 text-xs font-bold hover:border-[var(--color-brand)] transition-colors"
              >
                <Icon name="download" className="w-4 h-4 text-[var(--color-brand)]" />
                Login guide &amp; setup instructions
                <Icon
                  name="chevronRight"
                  className="w-3.5 h-3.5 ml-auto text-[var(--color-ink-faint)]"
                />
              </a>
            ) : (
              <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-[var(--color-line)] p-3 text-xs text-[var(--color-ink-soft)]">
                <Icon name="headset" className="w-4 h-4" />
                Setup instructions are sent with your order.
              </div>
            )}
          </div>

          {/* Quantity + total */}
          <div className="mt-5 rounded-2xl bg-[var(--color-page)] border border-[var(--color-line)] p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
                Quantity
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  aria-label="Decrease quantity"
                  disabled={quantity <= 1}
                  className="w-9 h-9 rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] flex items-center justify-center hover:border-[var(--color-brand)] disabled:opacity-40 transition-colors"
                >
                  <Icon name="minus" className="w-4 h-4" />
                </button>
                <span className="w-8 text-center font-extrabold tabular-nums">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => q + 1)}
                  aria-label="Increase quantity"
                  className="w-9 h-9 rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] flex items-center justify-center hover:border-[var(--color-brand)] transition-colors"
                >
                  <Icon name="plus" className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--color-line)]">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
                Total
              </span>
              <span className="text-2xl font-extrabold text-[var(--color-brand)] tabular-nums">
                {formatPrice(total)}
              </span>
            </div>
          </div>

          {/* Desktop CTA */}
          <button
            type="button"
            onClick={handleBuyNow}
            disabled={soldOut}
            className={`hidden lg:flex mt-4 w-full py-4 rounded-2xl items-center justify-center gap-2.5 text-sm font-extrabold uppercase tracking-widest transition-all ${
              soldOut
                ? "bg-[var(--color-line)] text-[var(--color-ink-faint)] cursor-not-allowed"
                : added
                  ? "bg-[var(--color-success)] text-white"
                  : "bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white"
            }`}
          >
            <Icon name={added ? "check" : "cart"} className="w-5 h-5" />
            {soldOut
              ? "Out of Stock"
              : added
                ? "Added to Cart"
                : `Buy Now — ${formatPrice(total)}`}
          </button>

          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className="hidden lg:block mt-2 w-full py-3 text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors"
          >
            View cart
          </button>

          {/* Support note */}
          <p className="text-[11px] text-[var(--color-ink-faint)] mt-4 leading-relaxed">
            Need a custom order or bulk pricing? Message us on{" "}
            <a
              href={`https://wa.me/${SUPPORT.whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-[var(--color-brand)] hover:underline"
            >
              WhatsApp
            </a>{" "}
            or{" "}
            <a
              href={SUPPORT.telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-[var(--color-brand)] hover:underline"
            >
              Telegram
            </a>
            .
          </p>
        </div>
      </div>

      {/* Related */}
      {related.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 mt-10 lg:mt-16">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.15em] mb-3">
            You may also like
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {related.map((item) => (
              <Link
                key={item.id}
                href={`/products/${item.slug}/`}
                className="group bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)] shadow-sm hover:shadow-md hover:border-[var(--color-brand)]/40 transition-all overflow-hidden"
              >
                <div className="aspect-square bg-gradient-to-br from-[var(--color-line)] to-[var(--color-panel)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset(item.image)}
                    alt={item.name}
                    loading="lazy"
                    className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="p-3">
                  <p className="text-sm leading-none mb-1">{item.country_flags}</p>
                  <h3 className="text-xs font-semibold line-clamp-2 group-hover:text-[var(--color-brand)] transition-colors">
                    {item.name}
                  </h3>
                  <p className="text-sm font-extrabold text-[var(--color-brand)] mt-1.5 tabular-nums">
                    {formatPrice(item.price)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Sticky mobile CTA */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--color-panel)]/95 backdrop-blur border-t border-[var(--color-line)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">
              Total
            </p>
            <p className="text-lg font-extrabold text-[var(--color-brand)] leading-tight tabular-nums">
              {formatPrice(total)}
            </p>
          </div>
          <button
            type="button"
            onClick={handleBuyNow}
            disabled={soldOut}
            className={`flex-1 py-3.5 rounded-xl flex items-center justify-center gap-2 text-sm font-extrabold uppercase tracking-wider transition-colors ${
              soldOut
                ? "bg-[var(--color-line)] text-[var(--color-ink-faint)]"
                : added
                  ? "bg-[var(--color-success)] text-white"
                  : "bg-[var(--color-brand)] text-white"
            }`}
          >
            <Icon name={added ? "check" : "cart"} className="w-5 h-5" />
            {soldOut ? "Out of Stock" : added ? "Added!" : "Buy Now"}
          </button>
        </div>
        <p className="text-[10px] text-[var(--color-ink-soft)] mt-1.5 text-center">
          {DELIVERY.promise} · {DELIVERY.guarantee}
        </p>
      </div>
    </div>
  );
}
