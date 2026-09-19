"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";
import { useCurrency } from "@/context/CurrencyContext";
import type { DeliveryDetails } from "@/lib/orders";
import { saveOrder } from "@/lib/orders";
import {
  buildAccountReference,
  buildOrderId,
  checkoutViaWhatsApp,
  createNowpaymentsInvoice,
  kesAmountFor,
  pollUntilSettled,
  type OrderStatus,
} from "@/lib/payments";
import { formatKES, GATEWAYS, type GatewayId } from "@/lib/currency";
import { DELIVERY, SUPPORT } from "@/lib/config";
import PalplusModal from "./PalplusModal";
import Icon from "./ui/Icon";

interface CheckoutOptionsProps {
  amountUsd: number;
  details: DeliveryDetails;
}

type Message = { type: "success" | "error" | "info"; text: string } | null;

export default function CheckoutOptions({
  amountUsd,
  details,
}: CheckoutOptionsProps) {
  const { items, clearCart } = useCart();
  const { user } = useAuth();
  const { balance, debit } = useWallet();
  const { currency, format, gateway } = useCurrency();

  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [completed, setCompleted] = useState<{
    orderId: string;
    method: string;
    status: OrderStatus;
  } | null>(null);

  // M-Pesa modal state
  const [palplusOpen, setPalplusOpen] = useState(false);

  // Crypto invoice state
  const [invoice, setInvoice] = useState<{
    orderId: string;
    url: string;
  } | null>(null);

  const canPayFromWallet = balance >= amountUsd;
  const amountKes = kesAmountFor(amountUsd);

  /**
   * Order identifiers are derived once per checkout attempt and stay stable
   * across re-renders — the webhook matches on them.
   */
  const orderIds = useMemo(
    () => ({
      orderId: buildOrderId(items),
      accountReference: buildAccountReference(items),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length, items[0]?.id, items[0]?.quantity]
  );

  /**
   * Mirrors the order into Firestore for the customer's history.
   *
   * Deliberately fire-and-forget: the PHP ledger is the authoritative payment
   * record, and a slow or unreachable database must never delay a gateway
   * redirect or an STK push. A hung write here previously stalled checkout.
   */
  const persist = (
    gatewayId: GatewayId | "Wallet" | "WhatsApp",
    reference: string,
    status: "pending" | "paid"
  ): void => {
    void saveOrder({
        orderId: orderIds.orderId,
        accountReference: orderIds.accountReference,
        userId: user?.uid ?? "guest",
        userEmail: user?.email ?? details.email,
        userName: user?.displayName ?? details.fullName,
        items,
        amountUsd,
        displayCurrency: currency,
        displayAmount: currency === "KES" ? amountKes : amountUsd,
        delivery: details,
        paymentMethod:
          gatewayId === "palplus"
            ? GATEWAYS.palplus.name
            : gatewayId === "nowpayments"
              ? GATEWAYS.nowpayments.name
              : gatewayId,
        paymentReference: reference,
      status,
    } as Parameters<typeof saveOrder>[0]).catch((err) => {
      console.error("Could not mirror order to Firestore:", err);
    });
  };

  const finish = (method: string, status: OrderStatus = "paid") => {
    setCompleted({ orderId: orderIds.orderId, method, status });
    clearCart();
  };

  /* ----------------------------- Wallet ----------------------------- */
  const handleWallet = async () => {
    setLoading("wallet");
    setMessage(null);
    if (!debit(amountUsd)) {
      setMessage({ type: "error", text: "Insufficient wallet balance." });
      setLoading(null);
      return;
    }
    persist("Wallet", orderIds.orderId, "paid");
    finish("Wallet balance");
    setLoading(null);
  };

  /* --------------------------- NOWPayments -------------------------- */
  const handleCrypto = async () => {
    setLoading("nowpayments");
    setMessage(null);

    const res = await createNowpaymentsInvoice({
      orderId: orderIds.orderId,
      priceUsd: Number(amountUsd.toFixed(2)),
      description: items.map((i) => `${i.name} x${i.quantity}`).join(", ").slice(0, 200),
      successUrl: `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/account/orders/`,
      cancelUrl: `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`,
    });

    if (!res.ok || !res.data?.invoice_url) {
      setMessage({
        type: "error",
        text: res.error ?? "Could not create the crypto invoice.",
      });
      setLoading(null);
      return;
    }

    // Persist in the background and hand the customer straight to the invoice.
    persist("nowpayments", res.data.invoice_id, "pending");
    setInvoice({ orderId: orderIds.orderId, url: res.data.invoice_url });
    window.open(res.data.invoice_url, "_blank", "noopener,noreferrer");
    setLoading(null);
  };

  /** Lets the customer confirm after returning from the hosted invoice. */
  const checkCryptoStatus = async () => {
    setLoading("check");
    setMessage(null);
    const final = await pollUntilSettled(orderIds.orderId, {
      timeoutMs: 15000,
      intervalMs: 3000,
    });
    if (final.status === "paid") {
      finish(GATEWAYS.nowpayments.name);
    } else {
      setMessage({
        type: "info",
        text:
          final.message ??
          "Not confirmed yet. Crypto invoices settle once the network confirms the transfer — this can take a few minutes.",
      });
    }
    setLoading(null);
  };

  /* ---------------------------- WhatsApp ---------------------------- */
  const handleWhatsApp = async () => {
    setLoading("whatsapp");
    setMessage(null);
    try {
      checkoutViaWhatsApp(
        orderIds.orderId,
        items,
        amountUsd,
        details,
        currency
      );
      persist("WhatsApp", orderIds.orderId, "pending");
      finish("WhatsApp", "pending");
    } catch {
      setMessage({ type: "error", text: "Could not open WhatsApp." });
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
        <h3 className="text-lg font-extrabold">
          {completed.status === "paid" ? "Payment Confirmed" : "Order Received"}
        </h3>
        <p className="text-xs text-[var(--color-ink-soft)] mt-1">
          {completed.method}
        </p>

        <div className="mt-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-page)] p-4 text-left">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
              Order reference
            </span>
            <span className="font-mono text-[11px] font-bold break-all text-right">
              {completed.orderId}
            </span>
          </div>
          <div className="mt-3 text-[11px] text-[var(--color-ink-soft)] leading-relaxed">
            We are preparing your accounts. They will be sent to{" "}
            <span className="font-bold text-[var(--color-ink)]">
              {details.email}
            </span>{" "}
            and your WhatsApp shortly.
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <a
            href={`https://wa.me/${SUPPORT.whatsapp}?text=${encodeURIComponent(
              `Hi, I just placed order ${completed.orderId}. Please confirm delivery.`
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
  const activeGateway = GATEWAYS[gateway];

  return (
    <div className="space-y-2.5">
      {/* Total */}
      <div className="flex items-end justify-between mb-2">
        <h3 className="text-sm font-bold uppercase tracking-wider">
          Choose Payment
        </h3>
        <div className="text-right">
          <p className="text-lg font-extrabold text-[var(--color-brand)] tabular-nums leading-tight">
            {format(amountUsd)}
          </p>
          {currency === "KES" && (
            <p className="text-[10px] text-[var(--color-ink-faint)] tabular-nums">
              ≈ ${amountUsd.toFixed(2)} USD
            </p>
          )}
        </div>
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

      {/* Primary gateway for the active currency */}
      {gateway === "palplus" ? (
        <button
          type="button"
          onClick={() => setPalplusOpen(true)}
          disabled={loading !== null}
          className="w-full p-3.5 rounded-xl bg-[#49B642] hover:bg-[#3da636] text-white text-sm font-bold flex items-center justify-between transition-colors disabled:opacity-50"
        >
          <span className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[11px] font-black">
              M
            </span>
            Pay with M-Pesa
          </span>
          <span className="text-[11px] font-medium opacity-80">
            {formatKES(amountKes)}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleCrypto}
          disabled={loading !== null}
          className="w-full p-3.5 rounded-xl bg-[#0F172A] hover:bg-[#1e293b] text-white text-sm font-bold flex items-center justify-between transition-colors disabled:opacity-50"
        >
          <span className="flex items-center gap-2">
            {loading === "nowpayments" ? (
              <Spinner />
            ) : (
              <span className="text-base leading-none">₿</span>
            )}
            Pay with Crypto
          </span>
          <span className="text-[11px] font-medium opacity-80">
            NOWPayments
          </span>
        </button>
      )}

      {/* Crypto invoice follow-up */}
      {invoice && (
        <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-page)] p-3.5">
          <p className="text-[11px] font-bold">Invoice created</p>
          <p className="text-[10px] text-[var(--color-ink-soft)] mt-1 leading-relaxed">
            Complete the transfer in the payment tab. Settles once the network
            confirms it.
          </p>
          <div className="flex gap-2 mt-2.5">
            <a
              href={invoice.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center py-2.5 rounded-lg bg-[var(--color-ink)] text-[var(--color-panel)] text-[11px] font-bold uppercase tracking-wider"
            >
              Reopen invoice
            </a>
            <button
              type="button"
              onClick={checkCryptoStatus}
              disabled={loading !== null}
              className="flex-1 py-2.5 rounded-lg border border-[var(--color-line)] text-[11px] font-bold uppercase tracking-wider hover:border-[var(--color-brand)] disabled:opacity-50 transition-colors"
            >
              {loading === "check" ? "Checking…" : "I've paid"}
            </button>
          </div>
        </div>
      )}

      {/* Wallet */}
      <button
        type="button"
        onClick={handleWallet}
        disabled={loading !== null || !canPayFromWallet}
        className={`w-full p-3.5 rounded-xl flex items-center justify-between text-sm font-bold transition-colors disabled:opacity-60 ${
          canPayFromWallet
            ? "bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white"
            : "bg-[var(--color-line)] text-[var(--color-ink-soft)]"
        }`}
      >
        <span className="flex items-center gap-2">
          {loading === "wallet" ? <Spinner /> : <Icon name="wallet" className="w-5 h-5" />}
          Pay with Wallet
        </span>
        <span className="text-[11px] font-medium opacity-80">
          {canPayFromWallet ? format(balance) : `Balance ${format(balance)}`}
        </span>
      </button>

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
        <span className="text-[11px] font-medium opacity-80">Manual</span>
      </button>

      <p className="text-[10px] text-[var(--color-ink-soft)] text-center leading-relaxed pt-1">
        Delivering to{" "}
        <span className="font-bold text-[var(--color-ink)]">{details.email}</span>
        {" · "}
        {details.country}
      </p>

      <p className="text-[10px] text-[var(--color-ink-faint)] text-center leading-relaxed">
        Paying in {currency} via {activeGateway.name}.{" "}
        <span className="font-bold">Change currency</span> in the header to pay
        another way.
      </p>

      {!user && (
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25 dark:text-amber-300 p-2.5 rounded-xl text-center">
          Sign in before ordering to keep your accounts in your dashboard
          forever.
        </p>
      )}

      {/* STK push modal — mounted only while open so state starts fresh */}
      {palplusOpen && (
        <PalplusModal
          key={orderIds.orderId}
          onClose={() => setPalplusOpen(false)}
          orderId={orderIds.orderId}
          accountReference={orderIds.accountReference}
          amountKes={amountKes}
          defaultPhone={details.whatsapp}
          onPaid={({ reference }) => {
            persist("palplus", reference ?? orderIds.orderId, "paid");
            setTimeout(() => {
              setPalplusOpen(false);
              finish(GATEWAYS.palplus.name);
            }, 1200);
          }}
        />
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
