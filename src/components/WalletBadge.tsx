"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { BRAND, COMMERCE, SUPPORT } from "@/lib/config";
import { formatBalance } from "@/lib/format";
import Icon from "./ui/Icon";

/**
 * Wallet balance pill. Clicking it opens a funding sheet.
 *
 * Note: balances cannot be credited from the client — this build has no
 * backend, so self-service top-up would let anyone mint money. The sheet
 * therefore routes the user to a real top-up channel and the balance is
 * updated once payment is confirmed out of band.
 */
export default function WalletBadge({ className = "" }: { className?: string }) {
  const { balance, hasFunded } = useWallet();
  const [open, setOpen] = useState(false);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const topUpMessage = encodeURIComponent(
    `Hi ${BRAND.fullName}, I'd like to top up my wallet. Amount: ${COMMERCE.symbol} `,
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Wallet balance"
        className={`flex items-center gap-1.5 pl-2 pr-2.5 sm:pr-3 py-1.5 rounded-full bg-[var(--color-line)] hover:bg-[var(--color-brand)]/10 hover:text-[var(--color-brand)] text-[var(--color-ink)] transition-colors ${className}`}
      >
        <span className="w-6 h-6 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center flex-shrink-0">
          <Icon name="wallet" className="w-3.5 h-3.5" />
        </span>
        <span className="text-xs font-bold tabular-nums whitespace-nowrap">
          {formatBalance(balance)}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Wallet"
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full sm:max-w-md bg-[var(--color-panel)] rounded-t-3xl sm:rounded-2xl shadow-xl animate-pop-in max-h-[90dvh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-line)]">
              <div className="flex items-center gap-2">
                <Icon name="wallet" className="w-5 h-5 text-[var(--color-brand)]" />
                <h2 className="font-bold">My Wallet</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-full hover:bg-[var(--color-line)] transition-colors"
              >
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>

            {/* Balance */}
            <div className="p-5">
              <div className="rounded-2xl bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-brand-strong)] text-white p-5 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-80">
                  Available balance
                </p>
                <p className="text-3xl font-extrabold mt-1 tabular-nums">
                  {formatBalance(balance)}
                </p>
                <p className="text-[11px] opacity-80 mt-2">
                  {hasFunded
                    ? "Use your balance for one-tap checkout."
                    : "Top up once, then check out in a single tap."}
                </p>
              </div>

              {/* Top-up presets (informational — actual top-up is off-site) */}
              <div className="mt-5">
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] mb-2">
                  Top-up amounts
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {COMMERCE.topUpPresets.map((amount) => (
                    <div
                      key={amount}
                      className="text-center py-2.5 rounded-xl border border-[var(--color-line)] text-xs font-bold tabular-nums"
                    >
                      {COMMERCE.symbol}
                      {amount.toLocaleString()}
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-[var(--color-ink-soft)] mt-4 leading-relaxed">
                Wallet top-ups are confirmed manually to keep your funds safe.
                Send your payment, then share the confirmation below and your
                balance is credited within minutes.
              </p>

              <div className="mt-4 space-y-2">
                <a
                  href={`https://wa.me/${SUPPORT.whatsapp}?text=${topUpMessage}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#25D366] hover:bg-[#1da851] text-white text-sm font-bold transition-colors"
                >
                  <Icon name="whatsapp" className="w-5 h-5" />
                  Top up via WhatsApp
                </a>
                <a
                  href={SUPPORT.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#229ED9] hover:bg-[#1d8cbf] text-white text-sm font-bold transition-colors"
                >
                  <Icon name="telegram" className="w-5 h-5" />
                  Top up via Telegram
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
