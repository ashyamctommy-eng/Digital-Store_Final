# Digital Hub Shop

A mobile-first **digital products marketplace** — social media accounts, SMS
verifications, premium VPN subscriptions and proxies — with instant delivery,
dual-currency pricing and M-Pesa + crypto checkout.

Next.js (App Router) + TypeScript + Tailwind CSS 4, exported as a static site
and deployed to cPanel/HostNin behind a small PHP payment API.

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
npm run typecheck      # tsc --noEmit
npm run lint
npm run build:cpanel   # production bundle -> ./dist  (site + PHP API + .htaccess)
```

---

## 1. Currency model

**USD is the single source of truth.** Every catalog price is stored as
`price_usd` and KES is derived at display time, so the two can never drift.

```ts
// src/lib/currency.ts
export const FX_RATE_KES = 130;   // 1 USD = 130 KES — change here to re-price
```

| Visitor | Detected by | Prices shown | Gateway |
| --- | --- | --- | --- |
| `country_code === "KE"` | `https://ipapi.co/json/` | `KSh 6,500` | **Palplus** (M-Pesa STK push) |
| anywhere else | same lookup | `$50.00` | **NOWPayments** (crypto invoice) |

Resolution order (`src/context/CurrencyContext.tsx`):

1. A manual choice saved in `localStorage` (`dhs.currency`) always wins.
2. IP geolocation via ipapi.co.
3. Fallback: USD.

A **failed** lookup is deliberately *not* persisted, so a transient network
problem cannot permanently pin a Kenyan visitor to USD.

The header carries a manual override pill — `🇰🇪 KES | 🇺🇸 USD` — with a small
globe badge that appears when the choice was auto-detected and lets the visitor
re-run detection.

---

## 2. Payments

> Both gateways run server-side. A static-only upload **cannot** take payments:
> creating a Palplus STK push and receiving a NOWPayments IPN both require a
> server, and both need API keys that must never ship in the browser bundle.

### Palplus — M-Pesa (KES)

Phone → `POST /api/palplus/initiate` → server triggers the STK push → the
browser polls `GET /api/orders/status` until a terminal state, showing a live
"check your phone" modal.

```
amount            integer KES   (Math.round(price_usd * FX_RATE_KES))
phone             254XXXXXXXXX
accountReference  max 12 chars  ← hard M-Pesa limit
transactionDesc   max 13 chars  ← hard M-Pesa limit
callbackUrl       https://…/api/palplus/webhook
```

**Note on the order reference.** The requested
`ORDER_[PRODUCT_ID]_[TIMESTAMP]` is **too long for M-Pesa**, which caps
`accountReference` at 12 characters. So the two are separated:

| Purpose | Value |
| --- | --- |
| Full order id (ledger, NOWPayments, order history, support) | `ORDER_vpn-nord-1y_1789820451527` |
| M-Pesa statement reference (12 chars) | `DHSVPVVONN5M` |

`src/lib/payments.ts` keeps the mapping; the webhook resolves the 12-char
reference back to the full order id.

### NOWPayments — crypto (USD)

`POST /api/nowpayments/create-invoice` creates a hosted invoice
(`price_amount`, `price_currency: "usd"`, `order_id`, `ipn_callback_url`) and the
customer is redirected to `invoice_url`. Settlement arrives by IPN.

### Webhook security

- **NOWPayments** signs the body with HMAC-SHA512 over the key-sorted JSON,
  using the IPN secret, in the `x-nowpayments-sig` header. A request that fails
  verification gets a 403 and never touches order state.
- **Palplus does not sign its callbacks.** The payload is therefore treated as a
  hint only: the server takes the transaction id from the body and **re-fetches
  the transaction from the Palplus API**, which is authoritative. A forged
  webhook cannot mark an order paid. Paid amounts are also checked against the
  expected amount.

---

## 3. cPanel / HostNin deployment

`npm run build:cpanel` produces `dist/` — upload its **contents** to
`public_html/`.

```
dist/
  index.html, 404.html, products/, account/, admin/, …   static site (34 pages)
  _next/            hashed JS/CSS/fonts
  assets/images/    product icons
  api/              PHP payment endpoints
  .htaccess         HTTPS, caching, security, webhook rules
```

Then, on the server:

1. Copy `dist/api/config.sample.php` → `dist/api/config.php` and fill in your
   Palplus and NOWPayments keys plus `public_base_url`.
2. `chmod 755 dist/api/data` so PHP can write the order ledger.
3. Point the Palplus channel callback and the NOWPayments IPN at
   `https://<domain>/api/palplus/webhook` and `/api/nowpayments/webhook`.
4. Visit `/api/config-status` to confirm both gateways report `configured`.

### About the SPA fallback in `.htaccess`

The requested
`RewriteCond %{REQUEST_FILENAME} !-f` + `RewriteRule ^ index.html [L]` is
**commented out on purpose**. This is a Next.js static export, not an SPA: every
route is a real directory with its own `index.html`, served by `DirectoryIndex`.
A blanket rewrite would return the homepage for **every** URL and destroy deep
links and SEO. Enable it only if you later switch to a true client-side-routed
SPA.

Webhook CORS headers are included, but note CORS is a *browser* policy — the
providers call the webhooks server-to-server, so those headers only matter if
you test the endpoints from a browser console.

---

## 4. Architecture

| Concern | Where |
| --- | --- |
| Brand, support, notices, wallet presets | `src/lib/config.ts` |
| Pricing / FX / gateway routing | `src/lib/currency.ts` |
| Catalog (22 items, `price_usd`) | `src/lib/products.ts` |
| Categories & quick-filter tags | `src/lib/categories.ts` |
| Gateway client (order ids, API calls, polling) | `src/lib/payments.ts` |
| Order model | `src/lib/orders.ts` |
| Cart / Wallet / Theme / Catalog / Currency | `src/context/` |
| Browser persistence (`useSyncExternalStore`) | `src/lib/browserStore.ts` |
| Payment API (PHP) | `server/api/` |
| Apache config | `deploy/cpanel/.htaccess` |
| Bundle builder | `scripts/build-cpanel.mjs` |

**Convention:** all browser-persisted state goes through
`src/lib/browserStore.ts`. Reading `localStorage` in a `useEffect` and calling
`setState` trips `react-hooks/set-state-in-effect` and causes an empty-state
flash on first paint.

**Convention:** local assets must be referenced through `asset()` from
`src/lib/asset.ts` so they resolve under a non-empty `basePath`. cPanel builds
use `basePath = ""`; GitHub Pages sets `NEXT_PUBLIC_BASE_PATH=/<repo>`.

---

## 5. Deployment targets

| Target | Command | basePath |
| --- | --- | --- |
| cPanel / HostNin | `npm run build:cpanel` → `dist/` | `""` |
| GitHub Pages | `NEXT_PUBLIC_BASE_PATH=/<repo> npm run build` | `/<repo>` |

`.github/workflows/deploy.yml` derives the Pages basePath from the repository
name automatically.

---

## 6. Known gaps

- **Credential delivery is not built.** Nothing yet stores or hands over
  account logins, and `/account/orders` cannot show them. This is the core
  product feature and is still missing.
- The catalog is a **static TypeScript array**; admin product edits are
  session-only and the UI says so.
- Orders are written to two places: the PHP ledger (authoritative for payment
  state) and Firestore (customer history). The ledger is what the UI trusts.
- Wallet balances live in `localStorage` and are deliberately **not**
  self-creditable — a client-side top-up button would let anyone mint money.
- Admin gating is client-side; enforce `ADMIN_EMAILS` in Firestore rules too.
- The Palplus `channelId` must be configured in the Palplus console (or set in
  `config.php`), otherwise the API returns `400 NO_DEFAULT_CHANNEL`.
