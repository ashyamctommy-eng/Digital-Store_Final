"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import CurrencySwitcher from "./CurrencySwitcher";
import WalletBadge from "./WalletBadge";
import DrawerMenu from "./DrawerMenu";
import Icon from "./ui/Icon";
import { useCart } from "@/context/CartContext";
import { useCatalog } from "@/context/CatalogContext";
import { DELIVERY } from "@/lib/config";

export default function Header() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { totalItems, setIsCartOpen } = useCart();
  const { query, setQuery } = useCatalog();
  const router = useRouter();
  const pathname = usePathname();

  /** Header search drives the shared catalog filter; jump home if needed. */
  const handleSearch = (value: string) => {
    setQuery(value);
    if (pathname !== "/") router.push("/");
  };

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-[var(--color-panel)]/95 backdrop-blur-md border-b border-[var(--color-line)]">
        {/* Thin promise strip */}
        <div className="bg-[var(--color-ink)] text-[var(--color-panel)] overflow-hidden">
          <div className="marquee-pause flex whitespace-nowrap">
            <div className="animate-marquee flex shrink-0 items-center gap-8 py-1.5 pr-8 text-[11px] font-semibold tracking-wide">
              {[0, 1].map((dup) => (
                <div key={dup} className="flex shrink-0 items-center gap-8">
                  <span className="flex items-center gap-1.5">
                    <Icon name="bolt" className="w-3.5 h-3.5 text-[var(--color-brand)]" />
                    {DELIVERY.promise}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Icon name="shield" className="w-3.5 h-3.5 text-[var(--color-brand)]" />
                    24-hour replacement guarantee
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Icon name="headset" className="w-3.5 h-3.5 text-[var(--color-brand)]" />
                    Support replies in under 1 hour
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Icon name="check" className="w-3.5 h-3.5 text-[var(--color-brand)]" />
                    Verified accounts &amp; clean IPs
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main bar */}
        <div className="max-w-6xl mx-auto px-3 sm:px-4">
          <div className="flex items-center gap-2 sm:gap-3 py-2.5 sm:py-3">
            {/* Hamburger */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="p-1.5 -ml-1 rounded-full text-[var(--color-ink)] hover:bg-[var(--color-line)] transition-colors flex-shrink-0"
            >
              <Icon name="menu" className="w-6 h-6" />
            </button>

            {/* Logo */}
            <div className="flex-shrink-0">
              <Logo />
            </div>

            {/* Desktop search */}
            <div className="hidden md:flex flex-1 justify-center px-4">
              <label className="relative w-full max-w-md">
                <span className="sr-only">Search products</span>
                <Icon
                  name="search"
                  className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search for products or categories"
                  className="w-full pl-9 pr-3 py-2 rounded-full bg-[var(--color-line)] border border-transparent focus:border-[var(--color-brand)] focus:bg-[var(--color-panel)] outline-none text-sm transition-colors placeholder:text-[var(--color-ink-faint)]"
                />
              </label>
            </div>

            <div className="flex-1 md:hidden" />

            {/* Actions */}
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              <CurrencySwitcher />
              <ThemeToggle className="hidden sm:inline-flex" />
              <WalletBadge />

              <button
                type="button"
                onClick={() => setIsCartOpen(true)}
                aria-label={`Open cart${totalItems ? `, ${totalItems} items` : ""}`}
                className="relative p-2 rounded-full text-[var(--color-ink)] hover:bg-[var(--color-line)] transition-colors"
              >
                <Icon name="cart" className="w-5 h-5 sm:w-6 sm:h-6" />
                {totalItems > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-brand)] text-white text-[10px] font-bold flex items-center justify-center">
                    {totalItems > 99 ? "99+" : totalItems}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Mobile search — the desktop one is hidden below md */}
          <div className="md:hidden pb-3">
            <label className="relative block">
              <span className="sr-only">Search products</span>
              <Icon
                name="search"
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search for products or categories"
                className="w-full pl-9 pr-3 py-2.5 rounded-full bg-[var(--color-line)] border border-transparent focus:border-[var(--color-brand)] focus:bg-[var(--color-panel)] outline-none text-sm transition-colors placeholder:text-[var(--color-ink-faint)]"
              />
            </label>
          </div>
        </div>
      </header>

      <DrawerMenu isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
