"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { categories } from "@/lib/categories";
import { BRAND, SUPPORT } from "@/lib/config";
import { useCatalog } from "@/context/CatalogContext";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";
import { formatBalance } from "@/lib/format";
import { setBodyScrollLock } from "@/lib/browserStore";
import ThemeToggle from "./ThemeToggle";
import Icon from "./ui/Icon";
import type { IconName } from "./ui/Icon";

interface DrawerMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Left-hand slide-in navigation. */
export default function DrawerMenu({ isOpen, onClose }: DrawerMenuProps) {
  const { setCategory, setTag, reset } = useCatalog();
  const { user, signOut } = useAuth();
  const { balance } = useWallet();
  const pathname = usePathname();
  const router = useRouter();

  // Lock body scroll and close on Escape while open.
  useEffect(() => {
    if (!isOpen) return;
    setBodyScrollLock(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      setBodyScrollLock(false);
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const goHome = () => {
    reset();
    if (pathname !== "/") router.push("/");
  };

  const pickCategory = (id: string) => {
    setTag(null);
    setCategory(id);
    onClose();
    if (pathname !== "/") router.push("/");
  };

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <aside className="absolute left-0 top-0 h-full w-[86%] max-w-xs bg-[var(--color-panel)] shadow-2xl flex flex-col animate-slide-in-left">
        {/* Head */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-line)]">
          <Link
            href="/"
            onClick={onClose}
            className="font-extrabold uppercase tracking-tight text-lg"
          >
            {BRAND.nameLead}
            <span className="text-[var(--color-brand)]">{BRAND.nameAccent}</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="p-1.5 rounded-full hover:bg-[var(--color-line)] transition-colors"
          >
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Account / wallet summary */}
          <div className="p-4 border-b border-[var(--color-line)]">
            {user ? (
              <div className="flex items-center gap-3">
                {user.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.photoURL}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center font-bold">
                    {(user.displayName || user.email || "U").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">
                    {user.displayName || "Customer"}
                  </p>
                  <p className="text-[11px] text-[var(--color-ink-soft)] truncate">
                    {user.email}
                  </p>
                </div>
              </div>
            ) : (
              <Link
                href="/auth/signin/"
                onClick={onClose}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white text-sm font-bold transition-colors"
              >
                <Icon name="user" className="w-4 h-4" />
                Sign In / Create Account
              </Link>
            )}

            <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--color-line)] px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-bold text-[var(--color-ink-soft)] uppercase tracking-wider">
                <Icon name="wallet" className="w-4 h-4" />
                Wallet
              </span>
              <span className="text-sm font-bold tabular-nums">
                {formatBalance(balance)}
              </span>
            </div>
          </div>

          {/* Categories */}
          <nav className="p-2">
            <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink-faint)]">
              Browse
            </p>
            <button
              type="button"
              onClick={() => {
                goHome();
                onClose();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-[var(--color-line)] transition-colors text-left"
            >
              <Icon name="grid" className="w-4 h-4 text-[var(--color-brand)]" />
              All products
            </button>

            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => pickCategory(cat.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-[var(--color-line)] transition-colors text-left"
              >
                <span className="w-4 text-center">{cat.icon}</span>
                {cat.name}
              </button>
            ))}
          </nav>

          {/* Account links */}
          <nav className="p-2 border-t border-[var(--color-line)]">
            <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink-faint)]">
              Account
            </p>
            {[
              { href: "/account/orders/", label: "My Orders", icon: "download" as IconName },
              { href: "/account/settings/", label: "Settings", icon: "filter" as IconName },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-[var(--color-line)] transition-colors"
              >
                <Icon name={item.icon} className="w-4 h-4 text-[var(--color-brand)]" />
                {item.label}
              </Link>
            ))}
            {user && (
              <button
                type="button"
                onClick={() => {
                  signOut();
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[var(--color-brand)] hover:bg-[var(--color-brand)]/10 transition-colors text-left"
              >
                <Icon name="logout" className="w-4 h-4" />
                Sign Out
              </button>
            )}
          </nav>

          {/* Support */}
          <div className="p-4 border-t border-[var(--color-line)]">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink-faint)] mb-3">
              Need help?
            </p>
            <div className="space-y-2">
              <a
                href={`https://wa.me/${SUPPORT.whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#25D366]/10 text-[#1da851] text-sm font-bold"
              >
                <Icon name="whatsapp" className="w-4 h-4" />
                WhatsApp {SUPPORT.whatsappDisplay}
              </a>
              <a
                href={SUPPORT.telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#229ED9]/10 text-[#1d8cbf] text-sm font-bold"
              >
                <Icon name="telegram" className="w-4 h-4" />
                @{SUPPORT.telegram}
              </a>
            </div>
          </div>
        </div>

        {/* Footer: theme switch */}
        <div className="p-4 border-t border-[var(--color-line)] flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
            Appearance
          </span>
          <ThemeToggle />
        </div>
      </aside>
    </div>
  );
}
