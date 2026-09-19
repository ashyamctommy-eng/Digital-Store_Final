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
| GET | `/api/inventory/counts` | Public stock counts, `COUNT(available)` |
| GET | `/api/orders/credentials?order_id&token` | Credentials for a paid order |
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
npm run test:php:unit         # 71 assertions: parsing, claiming, dispatch, HMAC
npm run test:php:concurrency  # 10 processes racing for 40 units
npm run test:php:http         # 42 end-to-end HTTP assertions
```

`test:php:http` starts PHP's built-in server with `tests/router.php`, which
emulates the `.htaccess` rewrites. It temporarily writes `config.php` pointing
at a throwaway data directory, and restores any existing one afterwards.

## Verified

- 71 unit assertions, 42 HTTP assertions and a 10-process concurrency test all
  pass against PHP 8.4.
- The concurrency test is the important one: 10 separate processes race for 40
  units and every unit goes to exactly one order.
- Still worth running **one sandbox transaction with your real keys** before
  going live — provider-side behaviour (STK delivery, invoice settlement, Resend
  acceptance) cannot be reproduced locally.
