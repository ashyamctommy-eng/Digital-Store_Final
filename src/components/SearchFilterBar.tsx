"use client";

import { popularTags, sortOptions } from "@/lib/categories";
import { useCatalog } from "@/context/CatalogContext";
import Icon from "./ui/Icon";

/**
 * Search + quick filters. The search input itself lives in the header so it
 * is always reachable; this bar owns the popular tag chips and sorting.
 */
export default function SearchFilterBar({ className = "" }: { className?: string }) {
  const { tag, toggleTag, sort, setSort, isFiltering, results, reset } = useCatalog();

  return (
    <section className={`w-full ${className}`} aria-label="Filter products">
      {/* Popular chips */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-3 sm:px-4 pb-1">
        <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[var(--color-ink-faint)] pr-1">
          Popular
        </span>
        {popularTags.map((chip) => {
          const active = tag?.toLowerCase() === chip.toLowerCase();
          return (
            <button
              key={chip}
              type="button"
              onClick={() => toggleTag(chip)}
              aria-pressed={active}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                active
                  ? "bg-[var(--color-brand)] border-[var(--color-brand)] text-white shadow-sm"
                  : "bg-[var(--color-panel)] border-[var(--color-line)] text-[var(--color-ink-soft)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
              }`}
            >
              {chip}
            </button>
          );
        })}
      </div>

      {/* Result summary + sort */}
      {isFiltering && (
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 mt-4">
          <p className="text-xs text-[var(--color-ink-soft)]">
            <span className="font-bold text-[var(--color-ink)]">{results.length}</span>{" "}
            {results.length === 1 ? "result" : "results"}
          </p>
          <div className="flex items-center gap-2">
            <label className="relative">
              <span className="sr-only">Sort by</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="appearance-none pl-3 pr-8 py-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] text-xs font-bold outline-none focus:border-[var(--color-brand)]"
              >
                {sortOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <Icon
                name="chevronDown"
                className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-ink-faint)]"
              />
            </label>
            <button
              type="button"
              onClick={reset}
              className="px-3 py-1.5 rounded-full text-xs font-bold text-[var(--color-brand)] hover:bg-[var(--color-brand)]/10 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
