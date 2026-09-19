"use client";

import { useState } from "react";
import type { DeliveryDetails } from "@/lib/orders";
import Icon from "./ui/Icon";

interface DeliveryFormProps {
  onSubmit: (details: DeliveryDetails) => void;
  onBack: () => void;
  /** Pre-fills from the signed-in Firebase user when available. */
  initial?: Partial<DeliveryDetails>;
}

const countries = [
  "Kenya",
  "Tanzania",
  "Uganda",
  "Nigeria",
  "Ghana",
  "South Africa",
  "Rwanda",
  "Ethiopia",
  "Other",
];

export default function DeliveryForm({
  onSubmit,
  onBack,
  initial,
}: DeliveryFormProps) {
  const [details, setDetails] = useState<DeliveryDetails>({
    fullName: initial?.fullName ?? "",
    email: initial?.email ?? "",
    whatsapp: initial?.whatsapp ?? "",
    country: initial?.country ?? "Kenya",
    notes: initial?.notes ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof DeliveryDetails, string>>>({});

  const update = (field: keyof DeliveryDetails, value: string) => {
    setDetails((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = () => {
    const next: Partial<Record<keyof DeliveryDetails, string>> = {};
    if (!details.fullName.trim()) next.fullName = "Name is required";
    if (!details.email.trim()) next.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email))
      next.email = "Enter a valid email";
    if (!details.whatsapp.trim()) next.whatsapp = "WhatsApp number is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) onSubmit(details);
  };

  const fieldClass = (hasError?: string) =>
    `w-full px-3.5 py-2.5 rounded-xl border bg-[var(--color-page)] text-sm outline-none transition-colors placeholder:text-[var(--color-ink-faint)] ${
      hasError
        ? "border-[var(--color-danger)]"
        : "border-[var(--color-line)] focus:border-[var(--color-brand)]"
    }`;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to cart"
          className="p-1.5 rounded-full hover:bg-[var(--color-line)] transition-colors"
        >
          <Icon name="chevronLeft" className="w-4 h-4" />
        </button>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider">
            Delivery Details
          </h3>
          <p className="text-[10px] text-[var(--color-ink-soft)]">
            Where should we send your accounts?
          </p>
        </div>
      </div>

      <div>
        <input
          type="text"
          placeholder="Full name *"
          value={details.fullName}
          onChange={(e) => update("fullName", e.target.value)}
          className={fieldClass(errors.fullName)}
        />
        {errors.fullName && (
          <p className="text-[10px] text-[var(--color-danger)] mt-1">
            {errors.fullName}
          </p>
        )}
      </div>

      <div>
        <input
          type="email"
          placeholder="Email address *"
          value={details.email}
          onChange={(e) => update("email", e.target.value)}
          className={fieldClass(errors.email)}
        />
        {errors.email && (
          <p className="text-[10px] text-[var(--color-danger)] mt-1">
            {errors.email}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <input
            type="tel"
            placeholder="WhatsApp number *"
            value={details.whatsapp}
            onChange={(e) => update("whatsapp", e.target.value)}
            className={fieldClass(errors.whatsapp)}
          />
          {errors.whatsapp && (
            <p className="text-[10px] text-[var(--color-danger)] mt-1">
              {errors.whatsapp}
            </p>
          )}
        </div>
        <select
          value={details.country}
          onChange={(e) => update("country", e.target.value)}
          aria-label="Country"
          className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-page)] text-sm outline-none focus:border-[var(--color-brand)]"
        >
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <textarea
        placeholder="Notes for our team (optional)"
        value={details.notes}
        onChange={(e) => update("notes", e.target.value)}
        rows={2}
        className={`${fieldClass()} resize-none`}
      />

      {/* Why we ask */}
      <div className="flex items-start gap-2 rounded-xl bg-[var(--color-line)] p-3">
        <Icon
          name="shield"
          className="w-4 h-4 text-[var(--color-success)] flex-shrink-0 mt-0.5"
        />
        <p className="text-[10px] text-[var(--color-ink-soft)] leading-relaxed">
          Your details are only used to deliver this order. Credentials are sent
          to your email and mirrored to your account dashboard.
        </p>
      </div>

      <button
        type="submit"
        className="w-full py-3.5 rounded-xl bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white text-sm font-extrabold uppercase tracking-wider transition-colors"
      >
        Continue to Payment
      </button>
    </form>
  );
}
