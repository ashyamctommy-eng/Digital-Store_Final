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

npm run test:php       # backend tests (needs a PHP CLI on PATH, 8.2+)
npm run verify         # typecheck + lint + backend tests + cPanel build
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

## 4. Fulfilment

### Stock

Each product has an `inventory_stock` queue (`server/api/lib/inventory.php`,
one JSON file per product). The admin pastes credentials in bulk at
**Admin → Stock & Credentials**; each line becomes one `available` unit and the
public stock count becomes `COUNT(available)`.

A product with **no uploaded rows keeps its catalog number**, so turning
inventory on can never accidentally empty the shop.

### Automatic dispatch

When a Palplus or NOWPayments webhook confirms payment:

1. the order is marked paid and the webhook gets its 2xx immediately;
2. `dispatch_order()` claims exactly the quantity purchased, marks those units
   `sold` and binds them to the order id;
3. the credentials appear on the confirmation screen and in Order History;
4. a copy is emailed to the buyer via Resend.

Dispatch is **idempotent** — a duplicate webhook returns the same units instead
of claiming more. If stock runs short the buyer receives what exists and the
shortfall is recorded for the admin.

Wallet and WhatsApp orders are **not** auto-fulfilled: the wallet has no
server-side ledger, so those are delivered manually and the confirmation says so.

### Hybrid SMS delivery

Some products are phone numbers, not accounts. Those are marked
`delivery_kind: "sms"` in the catalog and fulfilled by a fixed priority:

| # | Source | When it is used |
| --- | --- | --- |
| 1 | **Pre-bought stock** | Always tried first — numbers the admin uploaded (`PHONE_NUMBER \| INBOX_URL_OR_NOTES`). |
| 2 | **On-demand provider** ([smsotp.net](https://smsotp.net/api-support)) | Only when pre-bought stock is empty *and* the provider is configured *and* its balance is above `min_balance`. |
| 3 | **Out of Stock** | Neither available: the storefront disables purchase instead of taking money it cannot fulfil. |

The provider is never consulted before the order is paid, and never while
pre-bought stock lasts. `npm run test:php:http` proves both: it asserts the
provider is charged exactly zero times when static stock covers the order.

Which products are SMS, and their service codes, are **generated from the
TypeScript catalog** into `server/api/lib/catalog.php` by
`scripts/sync-catalog.mjs` (run automatically by `build:cpanel`). The browser
never tells the server how to fulfil an order, because fulfilment spends real
money.

On-demand numbers have no inbox link — the code lives with the provider — so
`/api/orders/sms-status` polls the provider server-side and caches the code onto
the order, and the Order Details page shows it in an embedded live feed.
Pre-bought numbers carry an inbox URL, which gets an "Open Live Inbox" button and
an optional embedded frame.

> The embedded frame grants `allow-same-origin` **only to third-party hosts**,
> since a real inbox needs its own cookies to show anything, and that flag is
> only dangerous when the framed document shares our origin.

### Proxy stock (uploaded by hand)

Proxy products are marked `delivery_kind: "proxy"`. They have **no on-demand
provider** — addresses are uploaded in the admin console and claimed from stock:

| # | Source | When it is used |
| --- | --- | --- |
| 1 | **Uploaded stock** | `IP:PORT` lines pasted in Stock & Credentials. |
| 2 | **Out of Stock** | Queue empty: purchase is disabled. |

One unit of a proxy product is worth `per_unit` addresses ("10 IPs", "25 IPs"),
so claiming is counted in **addresses** and chunked into units afterwards. Only
whole units are delivered: a buyer who paid for 10 addresses is never handed 7
because the queue ran short — that becomes a shortfall, and the leftover
addresses stay in stock for the next order.

**Accepted line formats** (one per line):

```
203.0.113.10:8080                       host:port
user:pass@203.0.113.10:8080             credentials first
203.0.113.10:8080:user:pass             credentials last
203.0.113.10:8080 | user:pass           pipe separated
```

Addresses are validated by `lib/proxyaddr.php` before they are stored. Private,
loopback, link-local, carrier-NAT and documentation ranges (`192.0.2.0/24`,
`198.51.100.0/24`, `203.0.113.0/24`) are refused — they cannot route for a buyer,
so storing one is a guaranteed support ticket.

### Proxy checker

Buyers and admins can test proxies instead of trusting them.
`POST /api/orders/proxies-check` (token-gated, buyer) and
`POST /api/admin/proxies/check` (admin key) connect **through** each proxy to
this site's own `/api/proxies/echo`, which reports the exit IP and the forwarding
headers it saw. From that, each address is graded on:

| Signal | How it is measured |
| --- | --- |
| **Health** | did the request complete inside the timeout |
| **Speed** | round-trip milliseconds, banded Excellent → Slow |
| **Anonymity** | `elite` when our IP never leaks and no forwarding headers arrive, `anonymous` when headers appear but our IP does not, `transparent` when our own IP is forwarded |
| **Type** | which of HTTP(S), SOCKS5, SOCKS4 actually carried the request |
| **IP score** | 0–100 composite of the above, used to rank the list |

The score is a **quality heuristic computed here**, not a reputation database —
it says how well an address performs, not whether it has a bad history. The
echo endpoint is used instead of a public service so checking costs nothing and
does not depend on a third party.

### Order history and credentials### Order history and credentials

`/account/orders` lists orders from a local index (`dhs.orders.v1`), merged with
Firestore for signed-in customers. The Order Details modal shows the purchased
items, usage warnings, and a `UID | Account Data | Copy` credential table, with
Copy-all and a `.txt` export.

Credentials are read through
`GET /api/orders/credentials?order_id=…&token=…`. Every order carries a random
`order_token` issued at checkout and stored only in the buyer's browser, so a
leaked order id does not expose credentials.

> **Note:** deleting an order removes it from the local list only. The buyer's
> email copy and the server-side records are untouched.

## 5. Architecture

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
| Inventory queue & dispatch | `server/api/lib/inventory.php`, `dispatch.php` |
| SMS provider client | `server/api/lib/smsotp.php` |
| Generated server catalog | `server/api/lib/catalog.php` (from `scripts/sync-catalog.mjs`) |
| Credentials email (Resend) | `server/api/lib/email.php` |
| Order History + details modal | `src/app/account/orders/`, `src/components/OrderDetailsModal.tsx` |
| Admin stock console | `src/app/admin/inventory/` |
| Local order index | `src/lib/orderStore.ts` |
| Live stock overlay | `src/context/StockContext.tsx` |
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

## 6. Deployment targets

| Target | Command | basePath |
| --- | --- | --- |
| cPanel / HostNin | `npm run build:cpanel` → `dist/` | `""` |
| GitHub Pages | `NEXT_PUBLIC_BASE_PATH=/<repo> npm run build` | `/<repo>` |

`.github/workflows/deploy.yml` derives the Pages basePath from the repository
name automatically.

---

## 7. Known gaps

- The catalog is a **static TypeScript array**; admin product edits are
  session-only and the UI says so.
- The admin stock console sits behind the `/admin` Google sign-in gate, so it
  needs both a signed-in admin and the `admin_api_key`.
- Wallet and WhatsApp orders are fulfilled by hand.
- The on-demand provider is a single point of failure for SMS when pre-bought
  stock is empty; keep some static numbers for your best sellers.
- Cancelling an unused on-demand number is not implemented — the provider's
  documented API v1.0 has no cancel endpoint.
- Orders are written to two places: the PHP ledger (authoritative for payment
  state) and Firestore (customer history). The ledger is what the UI trusts.
- Wallet balances live in `localStorage` and are deliberately **not**
  self-creditable — a client-side top-up button would let anyone mint money.
- Admin gating is client-side; enforce `ADMIN_EMAILS` in Firestore rules too.
- The Palplus `channelId` must be configured in the Palplus console (or set in
  `config.php`), otherwise the API returns `400 NO_DEFAULT_CHANNEL`.
