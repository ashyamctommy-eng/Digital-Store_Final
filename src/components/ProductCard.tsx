"use client";

import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { getCategory } from "@/lib/categories";
import { discountPercent, formatPrice, stockLabel } from "@/lib/format";
import { asset } from "@/lib/asset";
import type { Product } from "@/lib/products";
import Icon from "./ui/Icon";
import { useState } from "react";

export default function ProductCard({ product }: { product: Product }) {
  const { addToCart } = useCart();
  const [justAdded, setJustAdded] = useState(false);

  const category = getCategory(product.category);
  const off = discountPercent(product.price, product.original_price);
  const stock = stockLabel(product.stock);
  const soldOut = product.stock <= 0;

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (soldOut) return;
    addToCart({
      id: product.id,
      slug: product.slug,
      name: product.name,
      category: category?.name ?? product.category,
      price: product.price,
      image: product.image,
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1400);
  };

  return (
    <Link
      href={`/products/${product.slug}/`}
      className="group flex flex-col h-full bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)] shadow-sm hover:shadow-md hover:border-[var(--color-brand)]/40 transition-all duration-200 overflow-hidden"
    >
      {/* Visual */}
      <div className="relative aspect-square bg-gradient-to-br from-[var(--color-line)] to-[var(--color-panel)] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset(product.image)}
          alt={product.name}
          loading="lazy"
          className="w-full h-full object-contain p-4 sm:p-5 group-hover:scale-105 transition-transform duration-500"
        />

        {/* Top-left: badge / category */}
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          {product.badge && (
            <span className="text-[9px] font-extrabold uppercase tracking-wider px-2 py-1 rounded-full bg-[var(--color-brand)] text-white shadow-sm">
              {product.badge}
            </span>
          )}
          {category && (
            <span className="text-[9px] font-extrabold uppercase tracking-wider px-2 py-1 rounded-full bg-[var(--color-panel)]/90 backdrop-blur text-[var(--color-ink-soft)] border border-[var(--color-line)]">
              {category.name.replace(/ Accounts$/, "")}
            </span>
          )}
        </div>

        {/* Top-right: discount */}
        {off !== null && (
          <span className="absolute top-2 right-2 text-[9px] font-extrabold uppercase px-2 py-1 rounded-full bg-[var(--color-ink)] text-[var(--color-panel)]">
            −{off}%
          </span>
        )}

        {/* Quick add */}
        <button
          type="button"
          onClick={handleAdd}
          disabled={soldOut}
          aria-label={`Add ${product.name} to cart`}
          className={`absolute bottom-2 right-2 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 ${
            soldOut
              ? "bg-[var(--color-line)] text-[var(--color-ink-faint)] cursor-not-allowed"
              : justAdded
                ? "bg-[var(--color-success)] text-white scale-95"
                : "bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-strong)] active:scale-95"
          }`}
        >
          <Icon name={justAdded ? "check" : "cart"} className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-3">
        {/* Flags + stock */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-sm leading-none" aria-label="Available regions">
            {product.country_flags}
          </span>
          <span
            className={`text-[9px] font-bold uppercase tracking-wider ${
              stock.tone === "out"
                ? "text-[var(--color-danger)]"
                : stock.tone === "low"
                  ? "text-[var(--color-warning)]"
                  : "text-[var(--color-success)]"
            }`}
          >
            {stock.text}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-xs sm:text-sm font-semibold leading-snug line-clamp-2 group-hover:text-[var(--color-brand)] transition-colors">
          {product.name}
        </h3>

        {/* Price */}
        <div className="mt-auto pt-2.5 flex items-baseline gap-1.5 flex-wrap">
          <span className="text-base sm:text-lg font-extrabold text-[var(--color-brand)] tabular-nums">
            {formatPrice(product.price)}
          </span>
          {product.original_price && (
            <span className="text-[11px] text-[var(--color-ink-faint)] line-through tabular-nums">
              {formatPrice(product.original_price)}
            </span>
          )}
        </div>

        {/* Delivery note */}
        <p className="text-[10px] text-[var(--color-ink-soft)] mt-1 flex items-center gap-1">
          <Icon name="bolt" className="w-3 h-3 text-[var(--color-success)]" />
          {product.delivery ?? "Instant"} delivery
        </p>
      </div>
    </Link>
  );
}
