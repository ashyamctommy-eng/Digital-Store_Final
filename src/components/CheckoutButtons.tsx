"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";
import { useCurrency } from "@/context/CurrencyContext";
import { useStock } from "@/context/StockContext";
import type { DeliveryDetails } from "@/lib/orders";
import { saveOrder } from "@/lib/orders";
import {
  buildAccountReference,
  buildOrderId,
  checkoutViaWhatsApp,
  createNowpaymentsInvoice,
  fetchCredentials,
  kesAmountFor,
  toOrderLines,
  type DeliveredCredential,
  type OrderStatus,
} from "@/lib/payments";
import { formatKES, GATEWAYS, type GatewayId } from "@/lib/currency";
import { upsertOrder, patchOrder } from "@/lib/orderStore";
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
  const { refresh: refreshStock } = useStock();

  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [palplusOpen, setPalplusOpen] = useState(false);
  const [invoice, setInvoice] = useState<{ orderId: string; url: string } | null>(null);

  const [completed, setCompleted] = useState<{
    orderId: string;
    token: string;
    method: string;
    status: OrderStatus;
    autoFulfilled: boolean;
  } | null>(null);

  const [credentials, setCredentials] = useState<DeliveredCredential[] | null>(null);
  const [credsLoading, setCredsLoading] = useState(false);
  const [credsNote, setCredsNote] = useState("");

  const canPayFromWallet = balance >= amountUsd;
  const amountKes = kesAmountFor(amountUsd);
  const lines = useMemo(() => toOrderLines(items), [items]);

  /** Order identifiers are derived once per attempt and stay stable. */
  const orderIds = useMemo(
    () => ({
      orderId: buildOrderId(items),
      accountReference: buildAccountReference(items),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length, items[0]?.id, items[0]?.quantity]
  );

  /** Mirrors the order into Firestore. Fire-and-forget by design. */
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

  /** Records the order locally so Order History can list and reopen it. */
  const recordLocally = useCallback(
    (opts: {
      orderId: string;
      token: string;
      method: string;
      status: OrderStatus;
    }) => {
      upsertOrder({
        orderId: opts.orderId,
        token: opts.token,
        createdAt: new Date().toISOString(),
        status: opts.status,
        paymentMethod: opts.method,
        currency,
        amount: currency === "KES" ? amountKes : amountUsd,
        amountUsd,
        buyerEmail: details.email,
        items: lines,
      });
    },
    [currency, amountKes, amountUsd, details.email, lines]
  );

  /**
   * Fetches credentials, retrying briefly because dispatch runs just after the
   * webhook is acknowledged and can lag a second or two behind the payment.
   */
  const loadCredentials = useCallback(
    async (orderId: string, token: string) => {
      if (!token) {
        setCredsNote(
          "We could not attach a retrieval token to this order. Contact support and quote your order reference."
        );
        return;
      }

      setCredsLoading(true);
      setCredsNote("");

      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetchCredentials(orderId, token);
        if (res.ok && res.data) {
          if (res.data.credentials.length > 0) {
            setCredentials(res.data.credentials);
            patchOrder(orderId, {
              credentialCount: res.data.credentials.length,
              status: res.data.status,
              shortfall: res.data.shortfall,
            });
            refreshStock();
            setCredsLoading(false);
            return;
          }
          if (res.data.status === "paid" && attempt < 4) {
            // Paid but not yet dispatched — give the pipeline a moment.
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          setCredsNote(
            res.data.status === "pending"
              ? "Your payment is still confirming. Credentials will appear here and in your email the moment it settles."
              : "No credentials are attached to this order yet. Our team will send them shortly."
          );
          setCredsLoading(false);
          return;
        }

        setCredsNote(res.error ?? "Could not load your credentials.");
        setCredsLoading(false);
        return;
      }

      setCredsNote(
        "Your payment is confirmed. Credentials are being prepared and will appear in Order History."
      );
      setCredsLoading(false);
    },
    [refreshStock]
  );

  const finish = useCallback(
    (opts: {
      orderId: string;
      token: string;
      method: string;
      status: OrderStatus;
      autoFulfilled: boolean;
    }) => {
      setCompleted(opts);
      recordLocally(opts);
      clearCart();
      if (opts.autoFulfilled && opts.status === "paid") {
        void loadCredentials(opts.orderId, opts.token);
      }
    },
    [clearCart, recordLocally, loadCredentials]
  );

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
    finish({
      orderId: orderIds.orderId,
      token: "",
      method: "Wallet balance",
      status: "paid",
      autoFulfilled: false,
    });
    setLoading(null);
  };

  /* --------------------------- NOWPayments -------------------------- */
  const handleCrypto = async () => {
    setLoading("nowpayments");
    setMessage(null);

    const res = await createNowpaymentsInvoice({
      orderId: orderIds.orderId,
      items: lines,
      buyerEmail: details.email,
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

    persist("nowpayments", res.data.invoice_id, "pending");
    setInvoice({ orderId: orderIds.orderId, url: res.data.invoice_url });
    // Record now so the order is recoverable even if the buyer never returns.
    recordLocally({
      orderId: orderIds.orderId,
      token: res.data.order_token ?? "",
      method: GATEWAYS.nowpayments.name,
      status: "pending",
    });
    window.open(res.data.invoice_url, "_blank", "noopener,noreferrer");
    setLoading(null);
  };

  /**
   * Reads the retrieval token for an order from the local index.
   * The hosted crypto invoice opens in another tab, so the token has to come
   * back out of storage rather than component state.
   */
  const readToken = (orderId?: string): string => {
    if (!orderId) return "";
    try {
      const raw = localStorage.getItem("dhs.orders.v1");
      const list = raw ? JSON.parse(raw) : [];
      const found = Array.isArray(list)
        ? list.find((o: { orderId: string }) => o.orderId === orderId)
        : null;
      return found?.token ?? "";
    } catch {
      return "";
    }
  };

  /** Lets the buyer confirm after returning from the hosted invoice. */
  const checkCryptoStatus = async () => {
    setLoading("check");
    setMessage(null);
    const token = readToken(invoice?.orderId);
    const res = await fetchCredentials(invoice?.orderId ?? "", token);
    if (res.ok && res.data && res.data.credentials.length > 0) {
      finish({
        orderId: res.data.order_id,
        token,
        method: GATEWAYS.nowpayments.name,
        status: "paid",
        autoFulfilled: true,
      });
    } else {
      setMessage({
        type: "info",
        text:
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
      checkoutViaWhatsApp(orderIds.orderId, items, amountUsd, details, currency);
      persist("WhatsApp", orderIds.orderId, "pending");
      finish({
        orderId: orderIds.orderId,
        token: "",
        method: "WhatsApp",
        status: "pending",
        autoFulfilled: false,
      });
    } catch {
      setMessage({ type: "error", text: "Could not open WhatsApp." });
    }
    setLoading(null);
  };

  /* ----------------------------- Success ---------------------------- */
  if (completed) {
    return (
      <div className="py-4 animate-fade-up">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center mx-auto mb-4">
            <Icon name="check" className="w-8 h-8 text-[var(--color-success)]" />
          </div>
          <h3 className="text-lg font-extrabold">
            {completed.status === "paid" ? "Payment Confirmed" : "Order Received"}
          </h3>
          <p className="text-xs text-[var(--color-ink-soft)] mt-1">{completed.method}</p>
        </div>

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
            {completed.autoFulfilled
              ? "Your credentials are below and a copy is on its way to"
              : "Our team will send your credentials shortly to"}{" "}
            <span className="font-bold text-[var(--color-ink)]">{details.email}</span>.
          </div>
        </div>

        {/* Credentials */}
        {completed.autoFulfilled && (
          <div className="mt-3">
            {credsLoading && (
              <p className="text-[11px] text-[var(--color-ink-soft)] text-center py-3 animate-pulse">
                Preparing your credentials…
              </p>
            )}
            {!credsLoading && credentials && credentials.length > 0 && (
              <div className="rounded-2xl border border-[var(--color-line)] overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-success)] bg-[var(--color-success)]/10 px-3 py-2">
                  {credentials.length} credential
                  {credentials.length === 1 ? "" : "s"} delivered
                </p>
                <ul className="divide-y divide-[var(--color-line)]">
                  {credentials.map((cred, i) => (
                    <CredentialRow key={`${cred.uid}-${i}`} cred={cred} compact />
                  ))}
                </ul>
                <Link
                  href="/account/orders/"
                  className="block text-center py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-brand)] border-t border-[var(--color-line)]"
                >
                  View in Order History
                </Link>
              </div>
            )}
            {!credsLoading && credsNote && (
              <p className="text-[11px] text-[var(--color-ink-soft)] bg-[var(--color-line)] rounded-xl p-3 leading-relaxed">
                {credsNote}
              </p>
            )}
          </div>
        )}

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
          <Link
            href="/account/orders/"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-[var(--color-line)] text-sm font-bold hover:border-[var(--color-brand)] transition-colors"
          >
            <Icon name="download" className="w-4 h-4" />
            View My Orders
          </Link>
        </div>

        <p className="text-[10px] text-[var(--color-ink-faint)] mt-4 text-center">
          {DELIVERY.guarantee}
        </p>
      </div>
    );
  }

  /* ----------------------------- Methods ---------------------------- */
  const activeGateway = GATEWAYS[gateway];

  return (
    <div className="space-y-2.5">
      <div className="flex items-end justify-between mb-2">
        <h3 className="text-sm font-bold uppercase tracking-wider">Choose Payment</h3>
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
          <span className="text-[11px] font-medium opacity-80">{formatKES(amountKes)}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleCrypto}
          disabled={loading !== null}
          className="w-full p-3.5 rounded-xl bg-[#0F172A] hover:bg-[#1e293b] text-white text-sm font-bold flex items-center justify-between transition-colors disabled:opacity-50"
        >
          <span className="flex items-center gap-2">
            {loading === "nowpayments" ? <Spinner /> : <span className="text-base leading-none">₿</span>}
            Pay with Crypto
          </span>
          <span className="text-[11px] font-medium opacity-80">NOWPayments</span>
        </button>
      )}

      {invoice && (
        <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-page)] p-3.5">
          <p className="text-[11px] font-bold">Invoice created</p>
          <p className="text-[10px] text-[var(--color-ink-soft)] mt-1 leading-relaxed">
            Complete the transfer in the payment tab. Settles once the network confirms it.
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

      <button
        type="button"
        onClick={handleWhatsApp}
        disabled={loading !== null}
        className="w-full p-3.5 rounded-xl bg-[#25D366] hover:bg-[#1da851] text-white text-sm font-bold flex items-center justify-between transition-colors disabled:opacity-50"
      >
        <span className="flex items-center gap-2">
          {loading === "whatsapp" ? <Spinner /> : <Icon name="whatsapp" className="w-5 h-5" />}
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
        <span className="font-bold">Change currency</span> in the header to pay another way.
      </p>

      {!user && (
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25 dark:text-amber-300 p-2.5 rounded-xl text-center">
          Sign in before ordering to keep your accounts in your dashboard forever.
        </p>
      )}

      {palplusOpen && (
        <PalplusModal
          key={orderIds.orderId}
          onClose={() => setPalplusOpen(false)}
          orderId={orderIds.orderId}
          accountReference={orderIds.accountReference}
          amountKes={amountKes}
          items={lines}
          buyerEmail={details.email}
          defaultPhone={details.whatsapp}
          onPaid={({ reference, token }) => {
            persist("palplus", reference ?? orderIds.orderId, "paid");
            setTimeout(() => {
              setPalplusOpen(false);
              finish({
                orderId: orderIds.orderId,
                token: token ?? "",
                method: GATEWAYS.palplus.name,
                status: "paid",
                autoFulfilled: true,
              });
            }, 1200);
          }}
        />
      )}
    </div>
  );
}

/** One delivered credential, with a copy control. */
export function CredentialRow({
  cred,
  compact = false,
}: {
  cred: DeliveredCredential;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cred.account_data);
    } catch {
      // Clipboard blocked — fall back to a hidden textarea.
      const el = document.createElement("textarea");
      el.value = cred.account_data;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className={compact ? "px-3 py-2.5" : "p-3"}>
      {!compact && (
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)] mb-1">
          {cred.product_name}
        </p>
      )}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] font-bold break-all">{cred.uid}</p>
          <p className="font-mono text-[11px] text-[var(--color-ink-soft)] break-all mt-0.5">
            {cred.account_data}
          </p>
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy credential"
          className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${
            copied
              ? "bg-[var(--color-success)] text-white"
              : "border border-[var(--color-line)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </li>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
