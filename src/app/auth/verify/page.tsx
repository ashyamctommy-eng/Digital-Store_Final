"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { errorCode } from "@/lib/orders";

export default function VerifyEmailPage() {
  const { verifyEmail } = useAuth();
  const router = useRouter();
  const started = useRef(false);
  const [message, setMessage] = useState("Checking your verification link…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!token) {
      setMessage("This verification link is missing its token.");
      setFailed(true);
      return;
    }

    void verifyEmail(token)
      .then(() => {
        setMessage("Email verified. Your account is ready.");
        router.replace("/account/orders");
      })
      .catch((error: unknown) => {
        const code = errorCode(error);
        setMessage(
          code === "INVALID_VERIFICATION_TOKEN"
            ? "This link is invalid, expired, or already used. Request a new one from sign in."
            : "We could not verify your email right now. Please request a fresh link and try again.",
        );
        setFailed(true);
      });
  }, [router, verifyEmail]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-cream)] px-4">
      <section className="w-full max-w-md bg-white border border-gray-100 shadow-sm p-8 text-center">
        <h1 className="font-[var(--font-oswald)] text-2xl font-bold uppercase text-[var(--color-charcoal)]">
          Verify your email
        </h1>
        <p className={`mt-4 text-sm ${failed ? "text-red-700" : "text-gray-600"}`} aria-live="polite">
          {message}
        </p>
        {failed && (
          <Link
            href="/auth/signin"
            className="inline-block mt-6 px-5 py-3 bg-[var(--color-charcoal)] text-white text-xs font-bold uppercase tracking-wider"
          >
            Back to sign in
          </Link>
        )}
      </section>
    </main>
  );
}
