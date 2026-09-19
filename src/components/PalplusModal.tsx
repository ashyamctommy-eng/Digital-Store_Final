"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./ui/Icon";
import { formatKES } from "@/lib/currency";
import {
  initiatePalplus,
  isValidMpesaPhone,
  normalizeMpesaPhone,
  pollUntilSettled,
  type OrderStatus,
} from "@/lib/payments";

interface PalplusModalProps {
  onClose: () => void;
  /** Full order id (used as the ledger key). */
  orderId: string;
  /** 12-character M-Pesa account reference. */
  accountReference: string;
  amountKes: number;
  /** Pre-fills the phone field (usually the WhatsApp number on the order). */
  defaultPhone?: string;
  onPaid: (info: { reference?: string }) => void;
}

type Phase = "form" | "awaiting" | "success" | "failed";

const STATUS_COPY: Record<OrderStatus, string> = {
  pending: "Waiting for you to approve on your phone…",
  paid: "Payment received.",
  failed: "The payment did not go through.",
  cancelled: "You cancelled the prompt.",
  expired: "The request timed out.",
  unknown: "We could not confirm the payment.",
};

/**
 * M-Pesa STK push flow: collect the number, trigger the prompt, then poll our
 * server until Palplus reports a terminal state. The browser never holds a
 * Palplus key — the server proxies the call.
 */
export default function PalplusModal({
  onClose,
  orderId,
  accountReference,
  amountKes,
  defaultPhone = "",
  onPaid,
}: PalplusModalProps) {
  // Mounted === open. The parent renders this conditionally, so state is
  // naturally fresh for every order and no reset effect is needed.
  const [phone, setPhone] = useState(defaultPhone);
  const [phase, setPhase] = useState<Phase>("form");
  const [status, setStatus] = useState<OrderStatus>("pending");
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const settledRef = useRef(false);

  // Abort any in-flight polling when the modal unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const valid = isValidMpesaPhone(phone);

  const handleSend = async () => {
    const normalized = normalizeMpesaPhone(phone);
    if (!normalized) {
      setError("Enter a valid Safaricom number, e.g. 0712345678.");
      return;
    }

    setError("");
    setPhase("awaiting");
    setStatus("pending");
    setAttempts((n) => n + 1);

    const res = await initiatePalplus({
      orderId,
      accountReference,
      amountKes,
      phone: normalized,
      // Palplus caps this at 13 characters.
      transactionDesc: "Order payment",
    });

    if (!res.ok) {
      setPhase("form");
      setError(res.error ?? "Could not start the M-Pesa request.");
      return;
    }

    const startedStatus = res.data?.status ?? "pending";
    if (startedStatus !== "pending" && startedStatus !== "unknown") {
      setStatus(startedStatus);
      setPhase(startedStatus === "paid" ? "success" : "failed");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const final = await pollUntilSettled(orderId, {
      signal: controller.signal,
      onStatus: setStatus,
    });

    if (controller.signal.aborted) return;
    setStatus(final.status);

    if (final.status === "paid") {
      if (!settledRef.current) {
        settledRef.current = true;
        onPaid({ reference: final.reference });
      }
      setPhase("success");
    } else {
      setPhase("failed");
      setError(final.message ?? "");
    }
  };

  const inFlight = phase === "awaiting";

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="M-Pesa payment"
    >
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={inFlight ? undefined : onClose}
      />

      <div className="relative w-full sm:max-w-sm bg-[var(--color-panel)] rounded-t-3xl sm:rounded-2xl shadow-xl animate-pop-in max-h-[90dvh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-line)]">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-[#49B642] text-white flex items-center justify-center font-black text-sm">
              M
            </span>
            <div>
              <h2 className="text-sm font-bold">M-Pesa Payment</h2>
              <p className="text-[10px] text-[var(--color-ink-soft)]">
                Powered by Palplus
              </p>
            </div>
          </div>
          {!inFlight && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-full hover:bg-[var(--color-line)] transition-colors"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-4">
          {/* Amount */}
          <div className="rounded-2xl bg-[var(--color-page)] border border-[var(--color-line)] p-4 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink-faint)]">
              Amount to pay
            </p>
            <p className="text-2xl font-extrabold mt-1 tabular-nums">
              {formatKES(amountKes)}
            </p>
            <p className="text-[10px] text-[var(--color-ink-soft)] mt-1 font-mono">
              Ref {accountReference}
            </p>
          </div>

          {/* Phone form */}
          {(phase === "form" || phase === "failed") && (
            <div className="mt-4">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)] mb-1.5">
                M-Pesa phone number
              </label>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="2547XXXXXXXX"
                className="w-full px-3.5 py-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-page)] text-sm outline-none focus:border-[#49B642] tabular-nums"
              />
              {phone && !valid && (
                <p className="text-[10px] text-[var(--color-danger)] mt-1.5">
                  Use 0712345678, 0112345678 or +254712345678.
                </p>
              )}
              <p className="text-[10px] text-[var(--color-ink-soft)] mt-2 leading-relaxed">
                We will send a payment prompt to this number. Enter your M-Pesa
                PIN on your phone to complete the order.
              </p>

              {error && (
                <p className="mt-3 text-[11px] text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 rounded-xl p-2.5 leading-relaxed">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={handleSend}
                disabled={!valid}
                className="mt-4 w-full py-3.5 rounded-xl bg-[#49B642] hover:bg-[#3da636] text-white text-sm font-extrabold uppercase tracking-wider disabled:opacity-50 transition-colors"
              >
                {attempts > 0 ? "Retry payment" : "Send payment request"}
              </button>
            </div>
          )}

          {/* Awaiting PIN */}
          {inFlight && (
            <div className="mt-5 text-center">
              <div className="relative w-16 h-16 mx-auto">
                <span className="absolute inset-0 rounded-full border-4 border-[#49B642]/20" />
                <span className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#49B642] animate-spin" />
                <span className="absolute inset-0 flex items-center justify-center text-xl">
                  📲
                </span>
              </div>
              <p className="mt-4 text-sm font-bold">Check your phone</p>
              <p className="text-xs text-[var(--color-ink-soft)] mt-1 leading-relaxed">
                {STATUS_COPY[status]}
              </p>
              <p className="text-[11px] text-[var(--color-ink-faint)] mt-3 font-mono">
                {phone}
              </p>
              <button
                type="button"
                onClick={() => {
                  abortRef.current?.abort();
                  setPhase("form");
                }}
                className="mt-5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Success */}
          {phase === "success" && (
            <div className="mt-5 text-center">
              <div className="w-16 h-16 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center mx-auto">
                <Icon
                  name="check"
                  className="w-8 h-8 text-[var(--color-success)]"
                />
              </div>
              <p className="mt-3 text-sm font-extrabold">Payment confirmed</p>
              <p className="text-xs text-[var(--color-ink-soft)] mt-1">
                Your order is being prepared.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
