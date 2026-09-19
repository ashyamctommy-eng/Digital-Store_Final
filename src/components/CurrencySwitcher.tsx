"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrency } from "@/context/CurrencyContext";
import { CURRENCIES, type Currency } from "@/lib/currency";
import Icon from "./ui/Icon";

const OPTIONS: Currency[] = ["KES", "USD"];

/**
 * Currency switcher pill: 🇰🇪 KES | 🇺🇸 USD
 *
 * Shows the auto-detected currency on first visit and lets the visitor
 * override it. Long-pressing / tapping the globe reset restores auto-detect.
 */
export default function CurrencySwitcher({ className = "" }: { className?: string }) {
  const { currency, setCurrency, source, country, reDetect } = useCurrency();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <div
        className="flex items-center rounded-full bg-[var(--color-line)] p-0.5"
        role="group"
        aria-label="Display currency"
      >
        {OPTIONS.map((code) => {
          const active = currency === code;
          const meta = CURRENCIES[code];
          return (
            <button
              key={code}
              type="button"
              onClick={() => setCurrency(code)}
              aria-pressed={active}
              title={meta.label}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider transition-colors ${
                active
                  ? "bg-[var(--color-panel)] text-[var(--color-ink)] shadow-sm"
                  : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
              }`}
            >
              <span className="text-[11px] leading-none">{meta.flag}</span>
              <span className={active ? "" : "hidden sm:inline"}>{code}</span>
            </button>
          );
        })}
      </div>

      {/* Detection hint — only when we guessed rather than being told */}
      {source === "auto" && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`Currency auto-detected${country ? ` for ${country}` : ""}`}
          className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center"
        >
          <Icon name="globe" className="w-2.5 h-2.5" />
        </button>
      )}

      {open && source === "auto" && (
        <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] shadow-lg p-2 z-50 animate-pop-in">
          <p className="text-[10px] text-[var(--color-ink-soft)] px-2 py-1.5 leading-relaxed">
            Prices shown in {currency} based on your location
            {country ? ` (${country})` : ""}.
          </p>
          <button
            type="button"
            onClick={() => {
              reDetect();
              setOpen(false);
            }}
            className="w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-bold text-[var(--color-brand)] hover:bg-[var(--color-brand)]/10 transition-colors"
          >
            Re-detect my currency
          </button>
        </div>
      )}
    </div>
  );
}
