"use client";

import { useState } from "react";
import ProductGrid from "./ProductGrid";
import Icon from "./ui/Icon";
import { useCatalog } from "@/context/CatalogContext";
import type { Category } from "@/lib/categories";
import type { Product } from "@/lib/products";

interface CategorySectionProps {
  category: Category;
  products: Product[];
  /** How many cards to show before the "see more" affordance. */
  initialCount?: number;
}

/**
 * Full-width gradient category banner plus its product grid.
 * "See more" hands off to the shared catalog filter, which swaps the
 * homepage into results mode.
 */
export default function CategorySection({
  category,
  products,
  initialCount = 4,
}: CategorySectionProps) {
  const { setCategory, setTag } = useCatalog();
  const [expanded, setExpanded] = useState(false);

  if (products.length === 0) return null;

  const visible = expanded ? products : products.slice(0, initialCount);
  const hasMore = products.length > initialCount;

  const seeMore = () => {
    setTag(null);
    setCategory(category.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <section className="w-full" aria-labelledby={`cat-${category.id}`}>
      {/* Banner */}
      <div
        className={`relative overflow-hidden rounded-2xl bg-gradient-to-r ${category.gradient} text-white px-4 py-3.5 sm:py-4 shadow-sm`}
      >
        <div className="absolute -right-6 -top-8 text-[5rem] opacity-20 select-none pointer-events-none">
          {category.icon}
        </div>
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center text-lg flex-shrink-0">
              {category.icon}
            </span>
            <div className="min-w-0">
              <h2
                id={`cat-${category.id}`}
                className="font-extrabold uppercase tracking-wide text-sm sm:text-base truncate"
              >
                {category.name}
              </h2>
              <p className="text-[11px] text-white/80 truncate hidden sm:block">
                {category.tagline}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={seeMore}
            className="shrink-0 flex items-center gap-1 rounded-full bg-white/95 text-[var(--color-ink)] px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wider hover:bg-white transition-colors"
          >
            See More
            <Icon name="chevronRight" className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="mt-3">
        <ProductGrid products={visible} dense />
      </div>

      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 w-full py-2.5 rounded-xl border border-[var(--color-line)] text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] transition-colors"
        >
          Show {products.length - initialCount} more
        </button>
      )}
    </section>
  );
}
