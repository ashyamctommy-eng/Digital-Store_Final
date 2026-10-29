"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND } from "@/lib/config";
import { adminAuthMe, adminLogin, adminLogout } from "@/lib/adminApi";
import Icon from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/Icon";

const navItems: { href: string; label: string; icon: IconName }[] = [
  { href: "/admin/", label: "Dashboard", icon: "grid" },
  { href: "/admin/orders/", label: "Orders & Delivery", icon: "download" },
  { href: "/admin/products/", label: "Products", icon: "cart" },
  { href: "/admin/inventory/", label: "Stock & Credentials", icon: "grid" },
  { href: "/admin/users/", label: "Customers", icon: "user" },
  { href: "/admin/configurations/", label: "Configurations", icon: "filter" },
  { href: "/admin/integrations/", label: "Integrations", icon: "globe" },
  { href: "/admin/ghostproxies/", label: "GhostProxies", icon: "globe" },
  { href: "/admin/settings/", label: "Store Settings", icon: "filter" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    const loadSession = async () => {
      const result = await adminAuthMe();
      if (!active) return;
      if (result.ok && result.data) {
        setConfigured(result.data.configured);
        setUser(result.data.user);
      } else {
        setError(result.error ?? "Could not check administrator access.");
      }
      setLoading(false);
    };
    const handleExpired = () => {
      setUser(null);
      setPassword("");
      setError("Your administrator session expired. Sign in again.");
    };
    window.addEventListener("admin-session-expired", handleExpired);
    void loadSession();
    return () => {
      active = false;
      window.removeEventListener("admin-session-expired", handleExpired);
    };
  }, []);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const result = await adminLogin(email, password);
    setSubmitting(false);
    if (result.ok && result.data?.user) {
      setConfigured(true);
      setUser(result.data.user);
      setPassword("");
      return;
    }
    if (result.errorCode === "ADMIN_NOT_CONFIGURED" || result.status === 503) {
      setConfigured(false);
      setError("Admin login is not set up yet. Run installer.sh on the server.");
      return;
    }
    setError(result.error ?? "Invalid email or password.");
  };

  const handleLogout = async () => {
    const result = await adminLogout();
    if (result.ok) {
      setUser(null);
      setPassword("");
      setError("");
    } else {
      setError(result.error ?? "Could not sign out.");
    }
  };

  /* ------------------------- Auth gates ------------------------- */
  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-sm text-[var(--color-ink-soft)] animate-pulse">
          Checking access…
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)] shadow-sm p-6 text-center">
          <span className="inline-flex w-12 h-12 rounded-2xl bg-[var(--color-brand)] text-white items-center justify-center font-extrabold">
            {BRAND.nameLead.charAt(0)}
          </span>
          <h1 className="text-lg font-extrabold mt-3">Admin Access</h1>
          <p className="text-sm text-[var(--color-ink-soft)] mt-1">
            Sign in with the administrator account configured on this server.
          </p>

          {error && (
            <p className="mt-4 text-xs text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 rounded-xl p-2.5">
              {error}
            </p>
          )}

          {configured === false ? (
            <p className="mt-5 rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-left text-xs text-[var(--color-ink-soft)]">
              Run <code>bash installer.sh</code> on the server to create the first admin login.
            </p>
          ) : (
            <form onSubmit={handleLogin} className="mt-5 space-y-3 text-left">
              <label className="block text-xs font-bold">
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-page)] px-3 py-2.5 text-sm font-normal"
                />
              </label>
              <label className="block text-xs font-bold">
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-page)] px-3 py-2.5 text-sm font-normal"
                />
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-[var(--color-brand)] py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--color-brand-strong)] disabled:opacity-60"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}

          <Link
            href="/"
            className="inline-block mt-4 text-xs font-bold text-[var(--color-ink-soft)] hover:text-[var(--color-brand)]"
          >
            ← Back to store
          </Link>
        </div>
      </div>
    );
  }

  /* --------------------------- Console --------------------------- */
  return (
    <div className="min-h-dvh bg-[var(--color-page)] flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-[var(--color-panel)] border-r border-[var(--color-line)] z-50 transform transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-5 border-b border-[var(--color-line)]">
          <Link href="/admin/" className="block">
            <span className="font-extrabold uppercase tracking-tight">
              {BRAND.nameLead}
              <span className="text-[var(--color-brand)]">{BRAND.nameAccent}</span>
            </span>
            <span className="block text-[10px] font-bold tracking-[0.25em] text-[var(--color-ink-faint)] mt-0.5">
              ADMIN
            </span>
          </Link>
        </div>

        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname === item.href.slice(0, -1);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[var(--color-brand)] text-white"
                    : "text-[var(--color-ink-soft)] hover:bg-[var(--color-line)] hover:text-[var(--color-ink)]"
                }`}
              >
                <Icon name={item.icon} className="w-4 h-4 flex-shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-[var(--color-line)]">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors mb-3"
          >
            <Icon name="chevronLeft" className="w-3.5 h-3.5" />
            Back to Store
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[var(--color-brand)] flex items-center justify-center text-xs font-bold text-white">
              {user.email.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">
                Admin
              </p>
              <p className="text-[10px] text-[var(--color-ink-faint)] truncate">
                {user.email}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="p-1.5 rounded-full text-[var(--color-ink-faint)] hover:text-[var(--color-brand)] hover:bg-[var(--color-line)] transition-colors"
              title="Sign out"
            >
              <Icon name="logout" className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-[var(--color-panel)] border-b border-[var(--color-line)] px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-2 text-[var(--color-ink-soft)]"
            aria-label="Open sidebar"
          >
            <Icon name="menu" className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <span className="text-xs text-[var(--color-ink-soft)] hidden sm:block">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </header>

        <main className="flex-1 p-4 sm:p-6 overflow-auto">{children}</main>

        <footer className="border-t border-[var(--color-line)] px-6 py-4 text-center bg-[var(--color-panel)]">
          <p className="text-[10px] text-[var(--color-ink-faint)]">
            {BRAND.fullName} Admin — Built by{" "}
            <span className="font-bold text-[var(--color-ink)]">P.o.Riot🍄</span> |
            Powered by{" "}
            <span className="text-[var(--color-brand)] font-bold">
              WildPharmTech
            </span>
          </p>
        </footer>
      </div>
    </div>
  );
}
