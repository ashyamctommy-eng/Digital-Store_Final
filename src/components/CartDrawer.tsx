"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/context/CurrencyContext";
import DeliveryForm from "./DeliveryForm";
import CheckoutOptions from "./CheckoutButtons";
import Icon from "./ui/Icon";
import { asset } from "@/lib/asset";
import { DELIVERY } from "@/lib/config";
import type { DeliveryDetails } from "@/lib/orders";
import { setBodyScrollLock } from "@/lib/browserStore";

type Step = "cart" | "details" | "payment";

/**
 * Slide-in cart with a two-step digital checkout:
 * cart → delivery details → payment. No shipping step any more.
 */
export default function CartDrawer() {
  const {
    items,
    removeFromCart,
    updateQuantity,
    totalItems,
    totalPrice,
    isCartOpen,
    setIsCartOpen,
    lastAddedId,
  } = useCart();
  const { user } = useAuth();
  const { format } = useCurrency();

  const [step, setStep] = useState<Step>("cart");
  const [details, setDetails] = useState<DeliveryDetails | null>(null);

  const close = useCallback(() => {
    setIsCartOpen(false);
    // Reset after the exit so the drawer does not flash the first step.
    setTimeout(() => setStep("cart"), 250);
  }, [setIsCartOpen]);

  // Lock body scroll and close on Escape while open.
  useEffect(() => {
    if (!isCartOpen) return;
    setBodyScrollLock(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      setBodyScrollLock(false);
      window.removeEventListener("keydown", onKey);
    };
  }, [isCartOpen, close]);

  if (!isCartOpen) return null;

  const titles: Record<Step, string> = {
    cart: `Your Cart (${totalItems})`,
    details: "Delivery Details",
    payment: "Payment",
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]" onClick={close} />

      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-[var(--color-panel)] z-[70] shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center gap-2 p-4 border-b border-[var(--color-line)] flex-shrink-0">
          {step !== "cart" && (
            <button
              type="button"
              onClick={() => setStep(step === "payment" ? "details" : "cart")}
              aria-label="Back"
              className="p-1.5 rounded-full hover:bg-[var(--color-line)] transition-colors"
            >
              <Icon name="chevronLeft" className="w-4 h-4" />
            </button>
          )}
          <h2 className="font-bold text-sm uppercase tracking-wider flex-1">
            {titles[step]}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close cart"
            className="p-1.5 rounded-full hover:bg-[var(--color-line)] transition-colors"
          >
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* ---------------- Step 1: items ---------------- */}
          {step === "cart" &&
            (items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 rounded-full bg-[var(--color-line)] flex items-center justify-center mb-4">
                  <Icon
                    name="cart"
                    className="w-7 h-7 text-[var(--color-ink-faint)]"
                  />
                </div>
                <p className="font-bold">Your cart is empty</p>
                <p className="text-xs text-[var(--color-ink-soft)] mt-1">
                  Browse accounts, VPNs and proxies to get started.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="mt-5 px-6 py-2.5 rounded-xl bg-[var(--color-brand)] text-white text-xs font-bold uppercase tracking-wider"
                >
                  Continue Shopping
                </button>
              </div>
            ) : (
              <ul className="space-y-3">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={`flex gap-3 p-3 rounded-2xl border transition-colors ${
                      lastAddedId === item.id
                        ? "border-[var(--color-brand)]/40 bg-[var(--color-brand)]/5"
                        : "border-[var(--color-line)]"
                    }`}
                  >
                    <Link
                      href={`/products/${item.slug}/`}
                      onClick={close}
                      className="w-16 h-16 rounded-xl bg-[var(--color-page)] flex items-center justify-center flex-shrink-0 overflow-hidden"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset(item.image)}
                        alt={item.name}
                        className="w-full h-full object-contain p-1.5"
                      />
                    </Link>

                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-extrabold uppercase tracking-wider text-[var(--color-brand)]">
                        {item.category}
                      </p>
                      <h4 className="text-xs font-semibold leading-snug line-clamp-2 mt-0.5">
                        {item.name}
                      </h4>
                      <p className="text-sm font-extrabold mt-1 tabular-nums">
                        {format(item.price_usd * item.quantity)}
                      </p>

                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex items-center rounded-full border border-[var(--color-line)]">
                          <button
                            type="button"
                            onClick={() =>
                              updateQuantity(item.id, item.quantity - 1)
                            }
                            aria-label="Decrease quantity"
                            className="w-7 h-7 flex items-center justify-center hover:text-[var(--color-brand)] transition-colors"
                          >
                            <Icon name="minus" className="w-3 h-3" />
                          </button>
                          <span className="w-6 text-center text-xs font-bold tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateQuantity(item.id, item.quantity + 1)
                            }
                            aria-label="Increase quantity"
                            className="w-7 h-7 flex items-center justify-center hover:text-[var(--color-brand)] transition-colors"
                          >
                            <Icon name="plus" className="w-3 h-3" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.id)}
                          aria-label={`Remove ${item.name}`}
                          className="ml-auto p-1.5 rounded-full text-[var(--color-ink-faint)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
                        >
                          <Icon name="trash" className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ))}

          {/* ---------------- Step 2: details ---------------- */}
          {step === "details" && (
            <DeliveryForm
              onBack={() => setStep("cart")}
              onSubmit={(d) => {
                setDetails(d);
                setStep("payment");
              }}
              initial={{
                fullName: user?.displayName ?? "",
                email: user?.email ?? "",
              }}
            />
          )}

          {/* ---------------- Step 3: payment ---------------- */}
          {step === "payment" && details && (
            <CheckoutOptions amountUsd={totalPrice} details={details} />
          )}
        </div>

        {/* Footer — order summary on the cart step only */}
        {step === "cart" && items.length > 0 && (
          <div className="border-t border-[var(--color-line)] p-4 flex-shrink-0 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-ink-soft)]">
                Subtotal ({totalItems} {totalItems === 1 ? "item" : "items"})
              </span>
              <span className="font-extrabold text-lg tabular-nums">
                {format(totalPrice)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--color-ink-soft)]">
              <Icon
                name="bolt"
                className="w-3.5 h-3.5 text-[var(--color-success)]"
              />
              {DELIVERY.detail}
            </div>
            <button
              type="button"
              onClick={() => setStep("details")}
              className="w-full py-3.5 rounded-xl bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white text-sm font-extrabold uppercase tracking-wider transition-colors"
            >
              Proceed to Checkout
            </button>
          </div>
        )}
      </div>
    </>
  );
}
