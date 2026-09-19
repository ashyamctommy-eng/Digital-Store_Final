# Payment API (PHP)

cPanel/HostNin runs PHP out of the box, so the gateway calls live here rather
than in the static bundle. Provider keys are secrets and must never be compiled
into client JavaScript.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/palplus/initiate` | Create an M-Pesa STK push |
| POST | `/api/palplus/webhook` | Receive the M-Pesa result (Palplus callback) |
| POST | `/api/nowpayments/create-invoice` | Create a hosted crypto invoice |
| POST | `/api/nowpayments/webhook` | Receive the NOWPayments IPN |
| GET | `/api/orders/status?order_id=…` | Order status (used by the polling UI) |
| GET | `/api/config-status` | Which gateways are configured (no secrets) |
| GET | `/api/inventory/counts` | Public stock counts, `COUNT(available)` + `dynamic` |
| GET | `/api/orders/credentials?order_id&token` | Credentials for a paid order |
| GET | `/api/orders/sms-status?order_id&token` | Live inbox feed for SMS numbers |
| GET | `/api/admin/smsotp-status` | Provider balance + service list (admin key) |
| GET | `/api/admin/settings` | Configurable settings + setup checklist (admin key) |
| POST | `/api/admin/settings` | Save allow-listed settings (admin key) |
| POST | `/api/admin/settings/test` | Check a credential against the live provider (admin key) |
| POST | `/api/admin/proxies/check` | Test/rank pasted addresses (admin key) |
| POST | `/api/admin/inventory/add` | Bulk credential upload (admin key) |
| GET | `/api/admin/inventory/list` | Per-product stock totals (admin key) |
| POST | `/api/admin/inventory/delete` | Remove one unit (admin key) |

`api/.htaccess` rewrites the extensionless paths onto the `.php` files and
hard-blocks `lib/`, `data/` and `config.php` from HTTP.

## Setup

```bash
cp config.sample.php config.php     # then add your live keys
mkdir -p data && chmod 755 data     # PHP must be able to write the ledger
```

- `public_base_url` **must** be the site's public HTTPS URL — Palplus rejects
  `localhost` and private addresses, and it is where the callback URL points.
- `palplus.channel_id` is optional but usually required: without a default
  payment channel on the Palplus account the API returns `400 NO_DEFAULT_CHANNEL`.
- `palplus.auth_style` is `basic` by default, which sends
  `Authorization: Basic base64("<key>:")` as documented. Switch to `raw` if your
  gateway expects the key verbatim.

## Layout

```
api/
  config.sample.php      template (the real config.php is git-ignored)
  config-status.php      /api/config-status
  lib/http.php           JSON responses, config loading, request parsing
  lib/store.php          file-backed order ledger (atomic writes, flock)
  lib/palplus.php        Palplus client + status mapping
  lib/nowpayments.php    NOWPayments client + IPN signature verification
  palplus/{initiate,webhook}.php
  nowpayments/{create-invoice,webhook}.php
  orders/status.php
  data/                  order ledger (JSON) + events.log — blocked from HTTP
```

## Order ledger

Shared cPanel plans do not guarantee a database, so orders are JSON files with
`LOCK_EX` + atomic `rename`, plus a `ref_<accountReference>.json` index that maps
the 12-character M-Pesa reference back to the full order id.

`data/events.log` records every gateway interaction — the first place to look
when a payment does not settle.

## inventory_stock queue

One JSON file per product under `data/inventory/`. Each unit is
`{ id, uid, secret, fields, status, order_id, added_at, sold_at }` and moves
`available -> sold` exactly once.

Handing the same credential to two buyers is the worst failure this store can
have, so every mutation happens under an exclusive `flock` on a per-product
lock file, and read-modify-write never spans two lock acquisitions.

On payment the webhook calls `dispatch_order()`, which claims exactly the
purchased quantity, binds the units to the order id, and records a **shortfall**
if stock ran out — the buyer keeps what exists and the admin sees the gap rather
than a silent failure.

`data/inventory/<product>.json` and `data/events.log` are the first places to
look when a payment does not deliver.

## Hybrid SMS delivery

`catalog.php` (generated from `src/lib/products.ts` by
`scripts/sync-catalog.mjs`) marks which products are phone numbers and what the
provider spec is. Fulfilment for those follows a fixed priority in
`dispatch_claim_sms()`:

1. **Pre-bought stock** — units uploaded as `PHONE_NUMBER | INBOX_URL_OR_NOTES`.
   Field two becomes an `inbox_url` when it parses as http(s) and a plain note
   otherwise, so an admin can paste either without getting it wrong. A
   `javascript:` or `data:` value is refused at ingest and kept only as inert
   text, because the link is later rendered in an `<iframe>` and an `href`.
2. **On-demand purchase** — only when static stock is empty AND
   `smsotp.api_key` is set AND the balance exceeds `min_balance`. Never before
   the order is paid.
3. **Shortfall** — recorded for the admin, and the storefront shows Out of Stock
   from `COUNT(available)` plus the `dynamic` list.

`/api/inventory/counts` caches the provider balance for
`smsotp.balance_cache_seconds` (default 120) because the storefront asks for
counts on every page load; the authoritative check runs again at dispatch time.

## Configuration

`lib/settings.php` owns the schema for everything the console can change: labels,
hints, validation rules and grouping. The console renders itself from that, so
there is one definition rather than a PHP/TypeScript pair to drift apart.

`config_value()` checks `data/settings.json` before `config.php`, which is why no
gateway client had to change to pick these up. Clearing a value in the console
falls back to `config.php` — that is the supported way to revert without editing
files on the server.

Two keys are not in the schema at all: `admin_api_key` (it authorises the
console) and `data_dir` (moving it would move the file being read). Neither can
be written through the API, by design.

Writes are all-or-nothing: one invalid field rejects the batch, so a save cannot
half-apply.

## Proxy stock

`catalog.php` marks which products are IP:PORT batches and how many addresses a
unit is worth. `dispatch_claim_proxy()` claims whole units from the queue in
`inventory_stock`; there is no provider, so an empty queue is a shortfall and the
storefront shows Out of Stock.

Accepted upload formats: `HOST:PORT`, `USER:PASS@HOST:PORT`,
`HOST:PORT:USER:PASS` and `HOST:PORT | USER:PASS`. `lib/proxyaddr.php` refuses
private, loopback, link-local, carrier-NAT and documentation ranges at ingest.

## Proxy checker

`POST /api/orders/proxies-check` (buyer, token-gated) and
`POST /api/admin/proxies/check` (admin key) grade addresses by connecting
through them to `/api/proxies/echo` on this same host, which reports the exit IP
and forwarding headers. Results are ranked by a 0-100 heuristic covering health,
speed, anonymity and detected protocol. Uses `curl_multi`, a bounded concurrency
and a hard per-request cap so one call cannot tie up the server.

## Credential access

Each order gets a random 32-hex `order_token` at creation, returned only to the
buyer's browser. `/api/orders/credentials` requires it, so a leaked order id
(screenshot, support thread) does not expose credentials.

## Email

After dispatch, `settle_paid_order()` sends the credentials via Resend
(`POST https://api.resend.com/emails`). It runs after the webhook response has
been flushed, so the provider gets its 2xx first. Failures are logged, never
surfaced: the credentials are already on screen and in the ledger.

## Tests

```bash
npm run test:php              # everything
npm run test:php:requires     # every call resolves through its require chain
npm run test:php:unit         # parsing, claiming, dispatch, HMAC, proxy formats
npm run test:php:concurrency  # 10 processes racing for 40 units
npm run test:php:http         # end-to-end HTTP assertions
```

`test:php:http` also starts `tests/smsotp-stub.php`, a stub of the SMS provider
that records how many times it was charged — so "static stock is preferred" and
"no number is bought on an empty balance" are asserted, not assumed. Proxy
checking is exercised against a real forwarding proxy started on localhost, so
the health, anonymity and protocol detection paths are tested for real.

`test:php:http` starts PHP's built-in server with `tests/router.php`, which
emulates the `.htaccess` rewrites. It temporarily writes `config.php` pointing
at a throwaway data directory, and restores any existing one afterwards.

## Verified

- 110 unit assertions, 61 HTTP assertions, a require-chain check and a
  10-process concurrency test all pass against PHP 8.4.
- `tests/requires.php` exists because the same bug shipped twice: a library
  calling a helper from a module it did not require, failing only at runtime on
  whichever endpoint loaded it first. `php -l` cannot see it.
- The concurrency test is the important one: 10 separate processes race for 40
  units and every unit goes to exactly one order.
- Still worth running **one sandbox transaction with your real keys** before
  going live — provider-side behaviour (STK delivery, invoice settlement, Resend
  acceptance) cannot be reproduced locally.
