"use client";

import { useState } from "react";
import { BRAND, SUPPORT } from "@/lib/config";
import { FX_RATE_KES } from "@/lib/currency";
import { categories } from "@/lib/categories";
import {
  ICON_OPTIONS,
  TONE_OPTIONS,
  useNotices,
  type EditableNotice,
} from "@/lib/notices";
import Icon from "@/components/ui/Icon";

export default function AdminSettingsPage() {
  // Edits persist to this browser as they are typed.
  const { notices, update, reset } = useNotices();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const inputClass =
    "w-full px-3 py-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-page)] text-sm outline-none focus:border-[var(--color-brand)]";
  const labelClass =
    "block text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)] mb-1";
  const cardClass =
    "bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)] p-5";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold">Store Settings</h1>
        <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">
          Announcements, branding and support channels
        </p>
      </div>

      <div className="space-y-5 max-w-3xl">
        {/* Announcement cards */}
        <div className={cardClass}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
              Announcement Cards
            </h2>
            <button
              type="button"
              onClick={() => {
                reset();
                setSaved(false);
              }}
              className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand)] hover:underline"
            >
              Reset
            </button>
          </div>

          <p className="text-[11px] text-[var(--color-ink-soft)] mb-4 leading-relaxed">
            These drive the sliding notice carousel on the storefront. Edits
            save to this browser as you type and appear immediately.
          </p>

          <div className="space-y-4">
            {notices.map((notice, i) => (
              <div
                key={notice.id}
                className="rounded-xl border border-[var(--color-line)] p-3.5"
              >
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className={labelClass}>Icon</label>
                    <select
                      value={notice.icon}
                      onChange={(e) =>
                        update(i, { icon: e.target.value as EditableNotice["icon"] })
                      }
                      className={inputClass}
                    >
                      {ICON_OPTIONS.map((icon) => (
                        <option key={icon} value={icon}>
                          {icon}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Tone</label>
                    <select
                      value={notice.tone}
                      onChange={(e) =>
                        update(i, { tone: e.target.value as EditableNotice["tone"] })
                      }
                      className={inputClass}
                    >
                      {TONE_OPTIONS.map((tone) => (
                        <option key={tone} value={tone}>
                          {tone}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className={labelClass}>Title</label>
                    <input
                      value={notice.title}
                      onChange={(e) => update(i, { title: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Body</label>
                    <textarea
                      value={notice.body}
                      onChange={(e) => update(i, { body: e.target.value })}
                      rows={2}
                      className={`${inputClass} resize-none`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Link (optional)</label>
                      <input
                        value={notice.href ?? ""}
                        onChange={(e) => update(i, { href: e.target.value })}
                        placeholder="https://t.me/…"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Link label</label>
                      <input
                        value={notice.cta ?? ""}
                        onChange={(e) => update(i, { cta: e.target.value })}
                        placeholder="Open Telegram"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSave}
            className={`mt-4 w-full py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-colors ${
              saved
                ? "bg-[var(--color-success)] text-white"
                : "bg-[var(--color-ink)] text-[var(--color-panel)] hover:opacity-90"
            }`}
          >
            {saved ? "Saved" : "Announcements are live"}
          </button>
        </div>

        {/* Branding reference */}
        <div className={cardClass}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] mb-4">
            Brand
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl bg-[var(--color-page)] p-3">
              <p className={labelClass}>Store name</p>
              <p className="text-sm font-bold">{BRAND.fullName}</p>
            </div>
            <div className="rounded-xl bg-[var(--color-page)] p-3">
              <p className={labelClass}>Pricing</p>
              <p className="text-sm font-bold">
                USD base · 1 USD = {FX_RATE_KES} KES
              </p>
            </div>
          </div>
          <p className="text-[11px] text-[var(--color-ink-soft)] mt-3 leading-relaxed">
            Branding lives in <code>src/lib/config.ts</code> so it is compiled
            into the static build. Edit that file and redeploy to change it.
          </p>
        </div>

        {/* Support channels */}
        <div className={cardClass}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] mb-4">
            Support Channels
          </h2>
          <div className="space-y-2">
            {[
              { icon: "whatsapp" as const, label: "WhatsApp", value: SUPPORT.whatsappDisplay },
              { icon: "telegram" as const, label: "Telegram", value: `@${SUPPORT.telegram}` },
              { icon: "headset" as const, label: "Email", value: SUPPORT.email },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center gap-3 rounded-xl bg-[var(--color-page)] p-3"
              >
                <Icon name={row.icon} className="w-4 h-4 text-[var(--color-brand)]" />
                <span className="text-xs font-bold flex-1">{row.label}</span>
                <span className="text-xs text-[var(--color-ink-soft)]">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--color-ink-soft)] mt-3 leading-relaxed">
            Also in <code>src/lib/config.ts</code>. The floating support button,
            footer and cart all read from there.
          </p>
        </div>

        {/* Categories reference */}
        <div className={cardClass}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] mb-4">
            Catalog Categories
          </h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <span
                key={c.id}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold text-white bg-gradient-to-r ${c.gradient}`}
              >
                {c.icon} {c.name}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-[var(--color-ink-soft)] mt-3 leading-relaxed">
            Defined in <code>src/lib/categories.ts</code>. Product counts are
            managed under Products.
          </p>
        </div>

        {/* Security note */}
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-page)] p-4 flex items-start gap-3">
          <Icon
            name="shield"
            className="w-4 h-4 text-[var(--color-success)] flex-shrink-0 mt-0.5"
          />
          <p className="text-[11px] text-[var(--color-ink-soft)] leading-relaxed">
            Admin access is now gated by Google sign-in against an allowlist in{" "}
            <code>src/lib/config.ts</code>. The old stored-credential and OTP
            flow was removed — it kept passwords in the browser, which is not
            safe. Enforce the same allowlist in your Firestore security rules,
            since a client-side gate can be bypassed.
          </p>
        </div>
      </div>
    </div>
  );
}
