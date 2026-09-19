"use client";

import {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  ReactNode,
} from "react";
import {
  browseProducts,
  featuredProducts,
  type Product,
} from "@/lib/products";
import type { SortOption } from "@/lib/categories";

/**
 * Shared catalog browsing state.
 *
 * Lives in context (not in the page) so the header search box, the popular
 * tag chips, the category "See more" buttons and the results grid all stay in
 * sync — including while a user is on a product detail page and searches.
 */
interface CatalogContextType {
  query: string;
  setQuery: (value: string) => void;
  category: string | null;
  setCategory: (id: string | null) => void;
  tag: string | null;
  setTag: (tag: string | null) => void;
  sort: SortOption;
  setSort: (sort: SortOption) => void;
  /** Filters are non-default, i.e. the dedicated results view should show. */
  isFiltering: boolean;
  results: Product[];
  featured: Product[];
  reset: () => void;
  /** Toggles a chip: tapping the active tag clears it. */
  toggleTag: (tag: string) => void;
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("popular");

  const results = useMemo(
    () => browseProducts({ query, category, tag, sort }),
    [query, category, tag, sort]
  );

  const reset = useCallback(() => {
    setQuery("");
    setCategory(null);
    setTag(null);
    setSort("popular");
  }, []);

  const toggleTag = useCallback((next: string) => {
    setTag((prev) => (prev?.toLowerCase() === next.toLowerCase() ? null : next));
  }, []);

  const value = useMemo(
    () => ({
      query,
      setQuery,
      category,
      setCategory,
      tag,
      setTag,
      sort,
      setSort,
      isFiltering: Boolean(query.trim() || category || tag),
      results,
      featured: featuredProducts,
      reset,
      toggleTag,
    }),
    [query, category, tag, sort, results, reset, toggleTag]
  );

  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

export function useCatalog() {
  const context = useContext(CatalogContext);
  if (!context) {
    throw new Error("useCatalog must be used within a CatalogProvider");
  }
  return context;
}
