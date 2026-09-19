"use client";

import { useState } from "react";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";
import type { DeliveryDetails } from "@/lib/orders";
import { saveOrder } from "@/lib/orders";
import {
  checkoutViaWhatsApp,
  generateOrderRef,
  formatPhoneForMpesa,
  initiateMpesaSTKPush,
} from "@/lib/checkout";
import { COMMERCE, DELIVERY, SUPPORT } from "@/lib/config";
import { formatPrice } from "@/lib/format";
import Icon from "./ui/Icon";

interface CheckoutOptionsProps {
  amount: number;
  details: DeliveryDetails;
}

type Message = { type: "success" | "error" | "info"; text: string } | null;

export default function CheckoutOptions({ amount, details }: CheckoutOptionsProps) {
  const { items, clearCart } = useCart();
  const { user } = useAuth();
  const { balance, debit } = useWallet();

  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [showMpesa, setShowMpesa] = useState(false);
  const [phone, setPhone] = useState(details.whatsapp);
  const [completed, setCompleted] = useState<{ ref: string; method: string } | null>(null);

  const canPayFromWallet = balance >= amount;

  /** Persists the order; never blocks the customer flow if it fails. */
  const persist = async (
    method: string,
    reference: string,
    status: "pending" | "paid"
  ) => {
    try {
      await saveOrder({
        orderRef: reference,
        userId: user?.uid ?? "guest",
        userEmail: user?.email ?? details.email,
        userName: user?.displayName ?? details.fullName,
        items,
        totalAmount: amount,
        currency: COMMERCE.currency,
        delivery: details,
        paymentMethod: method,
        paymentReference: reference,
        status,
      });
    } catch (err) {
      console.error("Could not save order:", err);
    }
  };

  const finish = (ref: string, method: string) => {
    setCompleted({ ref, method });
    clearCart();
  };

  /* ----------------------------- Wallet ----------------------------- */
  const handleWallet = async () => {
    setLoading("wallet");
    setMessage(null);
    const ref = generateOrderRef();

    if (!debit(amount)) {
      setMessage({
        type: "error",
        text: "Insufficient wallet balance. Top up and try again.",
      });
      setLoading(null);
      return;
    }

    await persist("Wallet", ref, "paid");
    finish(ref, "Wallet balance");
    setLoading(null);
  };

  /* ----------------------------- M-Pesa ----------------------------- */
  const handleMpesa = async () => {
    if (!phone.trim()) {
      setMessage({ type: "error", text: "Enter the M-Pesa number to charge." });
      return;
    }
    setLoading("mpesa");
    setMessage(null);

    const ref = generateOrderRef();
    const result = await initiateMpesaSTKPush({
      phone: formatPhoneForMpesa(phone),
      amount,
      accountRef: ref,
    });

    if (result.success) {
      await persist("M-Pesa", result.checkoutRequestId ?? ref, "pending");
      finish(ref, "M-Pesa");
    } else {
      setMessage({
        type: result.manual ? "info" : "error",
        text: result.message,
      });
    }
    setLoading(null);
  };

  /* ---------------------------- WhatsApp ---------------------------- */
  const handleWhatsApp = async () => {
    setLoading("whatsapp");
    setMessage(null);
    const ref = generateOrderRef();
    try {
      checkoutViaWhatsApp(ref, items, amount, details);
      await persist("WhatsApp", ref, "pending");
      finish(ref, "WhatsApp");
    } catch {
      setMessage({ type: "error", text: "Could not open WhatsApp. Try again." });
    }
    setLoading(null);
  };

  /* ----------------------------- Success ---------------------------- */
  if (completed) {
    return (
      <div className="text-center py-6 animate-fade-up">
        <div className="w-16 h-16 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center mx-auto mb-4">
          <Icon name="check" className="w-8 h-8 text-[var(--color-success)]" />
        </div>
        <h3 className="text-lg font-extrabold">Order Received!</h3>
        <p className="text-xs text-[var(--color-ink-soft)] mt-1">
          Paid with {completed.method}
        </p>

        <div className="mt-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-page)] p-4 text-left">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
              Order reference
            </span>
            <span className="font-mono text-xs font-bold">{completed.ref}</span>
          </div>
          <div className="mt-3 text-[11px] text-[var(--color-ink-soft)] leading-relaxed">
            We are preparing your accounts now. They will be sent to{" "}
            <span className="font-bold text-[var(--color-ink)]">
              {details.email}
            </span>{" "}
            and your WhatsApp within minutes. Keep your reference for support.
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <a
            href={`https://wa.me/${SUPPORT.whatsapp}?text=${encodeURIComponent(
              `Hi, I just placed order ${completed.ref}. Please confirm delivery.`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#25D366] hover:bg-[#1da851] text-white text-sm font-bold transition-colors"
          >
            <Icon name="whatsapp" className="w-4 h-4" />
            Confirm on WhatsApp
          </a>
          {user && (
            <Link
              href="/account/orders/"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-[var(--color-line)] text-sm font-bold hover:border-[var(--color-brand)] transition-colors"
            >
              <Icon name="download" className="w-4 h-4" />
              View My Orders
            </Link>
          )}
        </div>

        <p className="text-[10px] text-[var(--color-ink-faint)] mt-4">
          {DELIVERY.guarantee}
        </p>
      </div>
    );
  }

  /* ----------------------------- Methods ---------------------------- */
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold uppercase tracking-wider">
          Choose Payment
        </h3>
        <span className="text-lg font-extrabold text-[var(--color-brand)] tabular-nums">
          {formatPrice(amount)}
        </span>
      </div>

      {message && (
        <div
          className={`p-3 rounded-xl text-[11px] leading-relaxed border ${
            message.type === "success"
              ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:border-green-500/25 dark:text-green-300"
              : message.type === "info"
                ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/25 dark:text-blue-300"
                : "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:border-red-500/25 dark:text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Wallet */}
      <button
        type="button"
        onClick={handleWallet}
        disabled={loading !== null}
        className={`w-full p-3.5 rounded-xl flex items-center justify-between text-sm font-bold transition-colors disabled:opacity-50 ${
          canPayFromWallet
            ? "bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white"
            : "bg-[var(--color-line)] text-[var(--color-ink-soft)]"
        }`}
      >
        <span className="flex items-center gap-2">
          {loading === "wallet" ? (
            <Spinner />
          ) : (
            <Icon name="wallet" className="w-5 h-5" />
          )}
          Pay with Wallet
        </span>
        <span className="text-[11px] font-medium opacity-80">
          {canPayFromWallet
            ? formatPrice(balance)
            : `Balance ${formatPrice(balance)}`}
        </span>
      </button>

      {/* M-Pesa */}
      {!showMpesa ? (
        <button
          type="button"
          onClick={() => setShowMpesa(true)}
          disabled={loading !== null}
          className="w-full p-3.5 rounded-xl bg-[#49B642] hover:bg-[#3da636] text-white text-sm font-bold flex items-center justify-between transition-colors disabled:opacity-50"
        >
          <span className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[11px] font-black">
              M
            </span>
            Pay via M-Pesa
          </span>
          <span className="text-[11px] font-medium opacity-80">Instant</span>
        </button>
      ) : (
        <div className="rounded-xl border-2 border-[#49B642] p-4 bg-[#49B642]/5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-8 h-8 rounded-full bg-[#49B642] text-white flex items-center justify-center font-black text-sm">
              M
            </span>
            <div>
              <p className="text-xs font-bold text-[#3da636] uppercase">
                M-Pesa Payment
              </p>
              <p className="text-[10px] text-[var(--color-ink-soft)]">
                Charge {formatPrice(amount)}
              </p>
            </div>
          </div>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 0712345678"
            className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-sm outline-none focus:border-[#49B642]"
          />
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => setShowMpesa(false)}
              className="flex-1 py-2.5 rounded-xl border border-[var(--color-line)] text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)] hover:bg-[var(--color-line)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleMpesa}
              disabled={loading === "mpesa" || !phone.trim()}
              className="flex-1 py-2.5 rounded-xl bg-[#49B642] hover:bg-[#3da636] text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {loading === "mpesa" && <Spinner />}
              {loading === "mpesa" ? "Sending…" : "Pay Now"}
            </button>
          </div>
        </div>
      )}

      {/* WhatsApp */}
      <button
        type="button"
        onClick={handleWhatsApp}
        disabled={loading !== null}
        className="w-full p-3.5 rounded-xl bg-[#25D366] hover:bg-[#1da851] text-white text-sm font-bold flex items-center justify-between transition-colors disabled:opacity-50"
      >
        <span className="flex items-center gap-2">
          {loading === "whatsapp" ? (
            <Spinner />
          ) : (
            <Icon name="whatsapp" className="w-5 h-5" />
          )}
          Order via WhatsApp
        </span>
        <span className="text-[11px] font-medium opacity-80">Fastest</span>
      </button>

      <p className="text-[10px] text-[var(--color-ink-soft)] text-center leading-relaxed pt-1">
        Delivering to{" "}
        <span className="font-bold text-[var(--color-ink)]">{details.email}</span>
        {" · "}
        {details.country}
      </p>

      {!user && (
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25 dark:text-amber-300 p-2.5 rounded-xl text-center">
          Sign in before ordering to keep your accounts in your dashboard
          forever.
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
