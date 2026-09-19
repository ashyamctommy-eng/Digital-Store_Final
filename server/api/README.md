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

## Verified

- Every endpoint's `require_once` targets resolve; brackets balance; no calls to
  undefined functions.
- No PHP runtime was available in the build environment, so these files were
  checked statically rather than executed. **Run one sandbox transaction with
  your real keys before going live.**
