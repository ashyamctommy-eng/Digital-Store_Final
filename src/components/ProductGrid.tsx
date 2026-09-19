import ProductCard from "./ProductCard";
import type { Product } from "@/lib/products";

interface ProductGridProps {
  products: Product[];
  className?: string;
  /** Tightens spacing for the compact rails. */
  dense?: boolean;
}

/** Responsive 2-column (mobile) product grid used across the storefront. */
export default function ProductGrid({
  products,
  className = "",
  dense = false,
}: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="text-center py-16 px-4">
        <p className="text-4xl mb-3">🔍</p>
        <p className="font-bold">No products match your filters</p>
        <p className="text-sm text-[var(--color-ink-soft)] mt-1">
          Try a different search term or clear the filters above.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`grid grid-cols-2 lg:grid-cols-4 ${
        dense ? "gap-2.5 sm:gap-3" : "gap-3 sm:gap-4"
      } ${className}`}
    >
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
