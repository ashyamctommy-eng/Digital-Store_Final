"use client";

import Link from "next/link";
import { BRAND, DELIVERY, SUPPORT } from "@/lib/config";
import { categories } from "@/lib/categories";
import { useCatalog } from "@/context/CatalogContext";
import Icon from "./ui/Icon";

const supportLinks = [
  { label: "Contact Us", href: `mailto:${SUPPORT.email}` },
  { label: "Replacement Policy", href: "#replacement" },
  { label: "Delivery Times", href: "#delivery" },
  { label: "Licence & Terms", href: "#terms" },
  { label: "FAQ", href: "#faq" },
];

const connectLinks = [
  { label: "Telegram Channel", href: SUPPORT.telegramUrl },
  { label: "WhatsApp", href: `https://wa.me/${SUPPORT.whatsapp}` },
  { label: "TikTok", href: "#" },
  { label: "Instagram", href: "#" },
  { label: "YouTube", href: "#" },
];

export default function Footer() {
  const { setCategory, setTag, reset } = useCatalog();

  return (
    <footer className="mt-12 sm:mt-16 bg-[var(--color-panel)] border-t border-[var(--color-line)]">
      <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Shop */}
          <div>
            <h4 className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[var(--color-ink-faint)] mb-4">
              Shop
            </h4>
            <ul className="space-y-2.5">
              <li>
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors"
                >
                  All Products
                </button>
              </li>
              {categories.map((cat) => (
                <li key={cat.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setTag(null);
                      setCategory(cat.id);
                    }}
                    className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors text-left"
                  >
                    {cat.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[var(--color-ink-faint)] mb-4">
              Support
            </h4>
            <ul className="space-y-2.5">
              {supportLinks.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Account */}
          <div>
            <h4 className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[var(--color-ink-faint)] mb-4">
              Account
            </h4>
            <ul className="space-y-2.5">
              <li>
                <Link
                  href="/account/orders/"
                  className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors"
                >
                  My Orders
                </Link>
              </li>
              <li>
                <Link
                  href="/account/settings/"
                  className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors"
                >
                  Account Settings
                </Link>
              </li>
              <li>
                <Link
                  href="/auth/signin/"
                  className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors"
                >
                  Sign In
                </Link>
              </li>
            </ul>
          </div>

          {/* Connect */}
          <div>
            <h4 className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[var(--color-ink-faint)] mb-4">
              Connect
            </h4>
            <ul className="space-y-2.5">
              {connectLinks.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    target={link.href.startsWith("http") ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Guarantee strip */}
        <div className="mt-10 rounded-2xl border border-[var(--color-line)] bg-[var(--color-page)] p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-6">
          <span className="flex items-center gap-2 text-xs font-bold">
            <Icon name="bolt" className="w-4 h-4 text-[var(--color-brand)]" />
            {DELIVERY.promise}
          </span>
          <span className="flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
            <Icon name="shield" className="w-4 h-4 text-[var(--color-success)]" />
            {DELIVERY.guarantee}
          </span>
        </div>

        {/* Payment methods */}
        <div className="mt-8">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[var(--color-ink-faint)] mb-3">
            We Accept
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "M-Pesa", className: "bg-[#49B642]/10 text-[#3da636] border-[#49B642]/25" },
              { label: "Wallet", className: "bg-[var(--color-brand)]/10 text-[var(--color-brand)] border-[var(--color-brand)]/25" },
              { label: "Visa", className: "bg-[var(--color-line)] text-[var(--color-ink-soft)] border-transparent" },
              { label: "Mastercard", className: "bg-[var(--color-line)] text-[var(--color-ink-soft)] border-transparent" },
              { label: "Paystack", className: "bg-[#09A5DB]/10 text-[#0890bf] border-[#09A5DB]/25" },
              { label: "USDT", className: "bg-[#26A17B]/10 text-[#1a7a5c] border-[#26A17B]/25" },
            ].map((method) => (
              <span
                key={method.label}
                className={`px-3 py-1.5 rounded-full text-[10px] font-bold border ${method.className}`}
              >
                {method.label}
              </span>
            ))}
          </div>
        </div>

        {/* Legal note — digital goods are not shippable returns */}
        <p className="mt-8 text-[11px] text-[var(--color-ink-faint)] leading-relaxed">
          All items sold are digital goods delivered electronically. Because
          access credentials cannot be returned once issued, refunds are limited
          to non-working items reported within 24 hours of delivery — see our
          replacement policy.
        </p>

        {/* Sign-off */}
        <div className="border-t border-[var(--color-line)] mt-8 pt-6 text-center">
          <p className="font-bold text-sm">
            made wt <span className="text-[var(--color-brand)]">♥️</span> by
            P.o.Riot🍄
          </p>
          <p className="text-[var(--color-ink-faint)] text-[10px] mt-2 tracking-wider">
            &copy; {new Date().getFullYear()} {BRAND.fullName}. All rights
            reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
