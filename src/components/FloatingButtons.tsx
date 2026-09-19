"use client";

import { useEffect, useState } from "react";
import { SUPPORT } from "@/lib/config";
import Icon from "./ui/Icon";

/**
 * Floating action stack (bottom-right):
 *  - Support bubble that expands into WhatsApp / Telegram / live-chat rows.
 *  - Scroll-to-top arrow, revealed after the first screenful.
 *
 * Kept at z-40 so cart drawers and modals (z-60+) always cover it.
 */
export default function FloatingButtons() {
  const [showTop, setShowTop] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const waMessage = encodeURIComponent("Hi! I need help with an order on Digital Hub Shop.");

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2.5">
      {/* Scroll to top */}
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Scroll to top"
        className={`w-11 h-11 rounded-full bg-[var(--color-panel)] border border-[var(--color-line)] shadow-lg flex items-center justify-center text-[var(--color-ink)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] transition-all duration-300 ${
          showTop
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-3 pointer-events-none"
        }`}
      >
        <Icon name="arrowUp" className="w-5 h-5" />
      </button>

      {/* Support menu */}
      {open && (
        <div className="flex flex-col items-end gap-2 animate-pop-in">
          <a
            href={`https://wa.me/${SUPPORT.whatsapp}?text=${waMessage}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 pl-4 pr-3 py-2.5 rounded-full bg-[#25D366] text-white text-xs font-bold shadow-lg hover:bg-[#1da851] transition-colors"
          >
            WhatsApp Support
            <Icon name="whatsapp" className="w-4 h-4" />
          </a>
          <a
            href={SUPPORT.telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 pl-4 pr-3 py-2.5 rounded-full bg-[#229ED9] text-white text-xs font-bold shadow-lg hover:bg-[#1d8cbf] transition-colors"
          >
            Telegram @{SUPPORT.telegram}
            <Icon name="telegram" className="w-4 h-4" />
          </a>
          <a
            href={`mailto:${SUPPORT.email}`}
            className="flex items-center gap-2 pl-4 pr-3 py-2.5 rounded-full bg-[var(--color-panel)] text-[var(--color-ink)] text-xs font-bold shadow-lg border border-[var(--color-line)] hover:border-[var(--color-brand)] transition-colors"
          >
            Email us
            <Icon name="headset" className="w-4 h-4" />
          </a>
        </div>
      )}

      {/* Support toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close support menu" : "Contact support"}
        aria-expanded={open}
        className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white transition-all duration-200 active:scale-95 ${
          open
            ? "bg-[var(--color-ink)] rotate-90"
            : "bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-brand-strong)] hover:shadow-2xl"
        }`}
      >
        <Icon name={open ? "close" : "headset"} className="w-6 h-6" />
      </button>
    </div>
  );
}
