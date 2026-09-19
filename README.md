# Digital Hub Shop

A mobile-first **digital products marketplace** — social media accounts, SMS
verifications, premium VPN subscriptions and proxies, with instant delivery.

Built with Next.js (App Router), TypeScript and Tailwind CSS 4, exported as a
fully static site and deployed to GitHub Pages.

> Previously this repository was an e-commerce store for physical sports
> apparel ("RiotGear"). It has been rebuilt around digital delivery: no sizes,
> no shipping addresses, no carrier integration.

---

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export into ./out
npm run lint
```

## Architecture

| Concern | Where it lives |
| --- | --- |
| Brand, support channels, currency | `src/lib/config.ts` |
| Catalog (products) | `src/lib/products.ts` |
| Categories & quick-filter tags | `src/lib/categories.ts` |
| Announcement cards | `src/lib/notices.ts` (defaults in `config.ts`) |
| Cart | `src/context/CartContext.tsx` |
| Wallet | `src/context/WalletContext.tsx` |
| Theme (light/dark) | `src/context/ThemeContext.tsx` |
| Search / filter state | `src/context/CatalogContext.tsx` |
| Browser persistence primitive | `src/lib/browserStore.ts` |
| Order model | `src/lib/orders.ts` |
| Payment helpers | `src/lib/checkout.ts` |

### Pages

- `/` — storefront: notice carousel, quick filters, featured rail, per-category
  banners with product grids. Switches to a flat filtered results view as soon
  as you search or tap a tag.
- `/products/[slug]/` — product detail: flag pills, spec list, login-guide link,
  availability, quantity selector, running total, sticky buy CTA.
- `/account/orders/`, `/account/settings/` — customer area.
- `/admin/*` — staff console (dashboard, orders & delivery, products,
  customers, integrations, store settings). Gated by Google sign-in against
  `ADMIN_EMAILS` in `src/lib/config.ts`.

### State & persistence

Because the site is a static export there is no server-rendered user state.
Anything browser-persisted (cart, wallet, theme, notices) goes through
`src/lib/browserStore.ts`, which wraps `useSyncExternalStore`. This avoids the
empty-flash and hydration mismatch you get from reading `localStorage` inside a
`useEffect`.

### Static-export constraints

`next.config.ts` sets `output: "export"` with `trailingSlash` and a `basePath`
of `/riotgear-storev11` in production. That means:

- No API routes, server actions, middleware, cookies or headers.
- Dynamic routes need `generateStaticParams()` — products are prerendered from
  `src/lib/products.ts`.
- Next.js image optimisation is off (`images.unoptimized`), so local assets must
  be referenced through `asset()` from `src/lib/asset.ts` to pick up the
  `basePath`. A bare `src="/assets/..."` will 404 on GitHub Pages.
- Client-side admin gating can be bypassed. Enforce the same allowlist in your
  Firestore security rules.

---

## ⚠️ Payments are not live yet

This matters before you take real orders.

- **Wallet** — the balance lives in `localStorage` and is intentionally *not*
  self-creditable, because a client-side top-up would let anyone mint money.
  Funding is confirmed manually; `credit()` is the hook a real ledger would call.
- **M-Pesa** — `src/lib/checkout.ts` calls Safaricom directly from the browser.
  A static host cannot hold a consumer secret, so without
  `NEXT_PUBLIC_MPESA_*` env vars configured it returns a `manual: true` result
  and routes the customer to WhatsApp. It **never** reports a fake success.
- **WhatsApp** — the only fully working path today. It builds an order summary
  and opens `wa.me`.
- **Card / Paystack** — not wired. The integrations screen is a placeholder and
  says so.

To go live, put the payment call behind a backend (or a merchant-of-record such
as Lemon Squeezy / Gumroad / Payhip, which also handles VAT and file delivery).

## Persisting catalog & orders

- Products are a **static TypeScript array**. The admin product editor is
  session-only and says so in the UI. Move products into Firestore to persist.
- Orders are written to the Firestore `orders` collection and read back by
  `/admin/orders` and `/account/orders`. Firebase config is in
  `src/lib/firebase.ts` — move it to env vars and restrict it with rules.

## Design system

Tokens are defined in `src/app/globals.css` under `@theme inline`, with a
class-based dark mode (`.dark` on `<html>`).

| Token | Value |
| --- | --- |
| `--color-page` | `#f8f9fa` light / `#0e1116` dark |
| `--color-panel` | `#ffffff` light / `#171b22` dark |
| `--color-brand` | `#e63946` |
| `--color-brand-strong` | `#dc2626` |
| `--color-blue` → `--color-blue-strong` | `#0066ff` → `#0052cc` (category banners) |

Cards use `rounded-2xl` with a soft shadow; the type scale is Inter with a
strong weight hierarchy. Legacy `--color-charcoal` / `--color-accent` /
`--color-gold` names are aliased onto the new tokens so the older admin screens
keep rendering.

## Deployment

`.github/workflows/deploy.yml` builds and publishes `./out` to GitHub Pages on
every push to `main`.
