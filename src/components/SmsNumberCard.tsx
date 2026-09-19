"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./ui/Icon";
import { copyText } from "@/lib/orderText";
import { fetchSmsStatus, type DeliveredCredential, type SmsNumber } from "@/lib/payments";

interface SmsNumberCardProps {
  cred: DeliveredCredential;
  orderId: string;
  token: string;
}

/** Only plain http(s) links are ever embedded. */
function safeUrl(value: string | null | undefined): string {
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : "";
}

/**
 * Sandbox flags for the inbox frame.
 *
 * Real inbox pages need cookies and session storage to show their own content,
 * which requires `allow-same-origin`. That combination is only dangerous when
 * the framed document shares our origin — at which point it could reach into
 * the parent page. So the flag is granted only for genuinely third-party hosts,
 * which is the normal case (the SMS provider's domain).
 */
function iframeSandbox(url: string): string {
  const base =
    "allow-forms allow-scripts allow-popups allow-popups-to-escape-sandbox";
  try {
    const host = new URL(url).host;
    if (host && host !== window.location.host) {
      return `${base} allow-same-origin`;
    }
  } catch {
    // Unparseable: stay maximally restrictive.
  }
  return base;
}

/**
 * One delivered SMS number.
 *
 * Pre-bought numbers come with an inbox link, so they get an
 * "[ Open Live Inbox ]" button plus an optional embedded view. Numbers bought
 * on demand have no link — the code lives with the provider — so the embedded
 * view polls our own endpoint instead, which keeps the buyer on the page.
 */
export default function SmsNumberCard({ cred, orderId, token }: SmsNumberCardProps) {
  const [copied, setCopied] = useState(false);
  const [showInbox, setShowInbox] = useState(false);

  const isDynamic = cred.source === "dynamic";
  const inboxUrl = safeUrl(cred.inbox_url);
  const phone = cred.phone_number ?? cred.uid;

  const [live, setLive] = useState<SmsNumber | null>(null);
  const [pollError, setPollError] = useState("");

  const code = live?.code ?? cred.code ?? null;
  const smsText = live?.text ?? null;
  // Derived, not stored: the card is listening whenever a dynamic number has
  // no code yet.
  const listening = isDynamic && !code && Boolean(token);

  const copyNumber = useCallback(async () => {
    const ok = await copyText(phone);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [phone]);

  // Poll for on-demand numbers while the card is open and the code has not
  // arrived yet. Stops as soon as it does.
  useEffect(() => {
    if (!isDynamic || code || !token) return;
    let cancelled = false;

    const tick = async () => {
      const res = await fetchSmsStatus(orderId, token);
      if (cancelled) return;
      if (res.ok && res.data) {
        const match =
          res.data.numbers.find((n) => n.uid === cred.uid) ?? res.data.numbers[0] ?? null;
        setLive(match);
        setPollError("");
      } else {
        setPollError(res.error ?? "Could not reach the inbox.");
      }
    };

    void tick();
    const timer = setInterval(tick, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isDynamic, code, token, orderId, cred.uid]);

  return (
    <li className="p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)] mb-2">
        {cred.product_name}
        {isDynamic && (
          <span className="ml-2 normal-case tracking-normal font-bold text-[var(--color-blue)]">
            on demand
          </span>
        )}
      </p>

      {/* Number + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[190px]">
          <span className="font-mono text-sm font-bold break-all">{phone}</span>
          <button
            type="button"
            onClick={copyNumber}
            aria-label={`Copy number ${phone}`}
            className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-colors ${
              copied
                ? "bg-[var(--color-success)] text-white"
                : "border border-[var(--color-line)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
            }`}
          >
            <Icon name={copied ? "check" : "download"} className="w-3 h-3" />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {inboxUrl && (
            <a
              href={inboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white text-[11px] font-bold transition-colors"
            >
              📥 Open Live Inbox
            </a>
          )}
          {(inboxUrl || isDynamic) && (
            <button
              type="button"
              onClick={() => setShowInbox((v) => !v)}
              aria-expanded={showInbox}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--color-line)] text-[11px] font-bold hover:border-[var(--color-brand)] transition-colors"
            >
              <Icon name={showInbox ? "close" : "grid"} className="w-3.5 h-3.5" />
              {showInbox ? "Hide" : "Watch here"}
            </button>
          )}
        </div>
      </div>

      {/* Delivered code */}
      {code && (
        <div className="mt-3 rounded-xl bg-[var(--color-success)]/10 border border-[var(--color-success)]/25 p-3">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[var(--color-success)]">
            Code received
          </p>
          <p className="font-mono text-lg font-extrabold tracking-wider mt-0.5">
            {code}
          </p>
          {smsText && (
            <p className="text-[10px] text-[var(--color-ink-soft)] mt-1 break-words">
              {smsText}
            </p>
          )}
        </div>
      )}

      {!code && isDynamic && (
        <p className="mt-2 text-[10px] text-[var(--color-ink-soft)] flex items-center gap-1.5">
          {listening && (
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-warning)] animate-pulse" />
          )}
          {pollError || "Waiting for the code to arrive — this updates automatically."}
        </p>
      )}

      {cred.notes && !code && (
        <p className="mt-2 text-[10px] text-[var(--color-ink-soft)] break-words">
          {cred.notes}
        </p>
      )}

      {/* Embedded inbox */}
      {showInbox && (
        <div className="mt-3 rounded-xl border border-[var(--color-line)] overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[var(--color-page)] border-b border-[var(--color-line)]">
            <span className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[var(--color-ink-faint)]">
              {inboxUrl ? "Live inbox" : "Live code feed"}
            </span>
            <span className="text-[9px] text-[var(--color-ink-faint)]">
              {inboxUrl ? "external page" : "auto-refreshing"}
            </span>
          </div>

          {inboxUrl ? (
            <>
              <iframe
                src={inboxUrl}
                title={`Inbox for ${phone}`}
                sandbox={iframeSandbox(inboxUrl)}
                // Never leak the order page as the referrer.
                referrerPolicy="no-referrer"
                loading="lazy"
                className="w-full h-[420px] bg-white"
              />
              <p className="px-3 py-2 text-[9px] text-[var(--color-ink-faint)] border-t border-[var(--color-line)]">
                Some inbox providers block embedding. If the frame stays blank,
                use “Open Live Inbox”.
              </p>
            </>
          ) : (
            <div className="p-4 text-center bg-[var(--color-page)]">
              {code ? (
                <>
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[var(--color-success)]">
                    Code received
                  </p>
                  <p className="font-mono text-2xl font-extrabold tracking-[0.2em] mt-1">
                    {code}
                  </p>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 mx-auto rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-brand)] animate-spin" />
                  <p className="text-[11px] text-[var(--color-ink-soft)] mt-3">
                    Listening for the SMS…
                  </p>
                  <p className="text-[9px] text-[var(--color-ink-faint)] mt-1">
                    The code appears here the moment it lands.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
