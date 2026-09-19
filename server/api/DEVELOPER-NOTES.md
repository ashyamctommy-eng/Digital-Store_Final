# Provider notes — verified against the live services

These notes exist because the implementation brief and the providers' own
documentation disagreed with reality in ways that would have produced dead code.
Everything below was checked by calling the live endpoints on 2026-09-19.
Re-verify before trusting a detail; providers change.

---

## NextProxy (proxy supply)

Base hosts `https://console.nextproxy.site` and `https://nextproxy.site` return
identical responses.

### What the brief said, and what is actually true

| Brief | Reality |
| --- | --- |
| `GET /api/list?format=json&limit=N&country=CC&key=KEY` | Works, but so does `/api/proxies`, which is the documented route. Both return the same public pool. Implemented as configurable (`nextproxy.list_path`). |
| API key format `nex_live_…` | Nothing documents a key format. A key is not required at all — see below. |
| "Remaining API credits fetched from the NextProxy profile endpoint" | **No such endpoint exists.** `/api/profile` and `/api/credits` both return `{"error":"Endpoint not found"}` with HTTP 404. |

### The `/api/random` shape (a common first-snippet mistake)

`/api/random` wraps the address in a `proxy` object — it is **not** flat:

```json
{"status":"success",
 "proxy":{"ip":"147.139.134.0","port":"3011","type":"https","country":"US", …},
 "clientTier":"Free Starter Tier (60 req/min · Free Pool Only)",
 "timestamp":"2026-09-19T14:56:11+00:00"}
```

So `$response['ip']` is undefined and prints an empty string (plus a PHP warning),
because the address lives at `$response['proxy']['ip']`. Working version:

```php
$res = json_decode($body, true);
$proxy = $res['proxy'] ?? null;          // <-- nested, not top level
if (($res['status'] ?? '') === 'success' && $proxy && empty($proxy['masked'])) {
    echo "Live Proxy: {$proxy['ip']}:{$proxy['port']}
";
} else {
    echo "No usable proxy (masked row or error).
";
}
```

Note the `masked` check: on the free tier the address frequently comes back as
`185.162.•••.•••`, and echoing that to a customer is worse than saying nothing.

### Authentication

A key is **optional**. The pool is served to unauthenticated callers:

```
GET /api/proxies?format=json&limit=1          -> HTTP 200, real addresses
GET /api/proxies?format=json&limit=1&key=x    -> HTTP 401 {"status":"error","code":401,
                                                 "message":"Invalid API key provided."}
```

So a key is validated *when supplied*, and a wrong one fails the whole request —
which is exactly the failure mode that would look like an outage. Both auth
styles work:

```
?key=<key>              query parameter
X-API-Key: <key>        header
```

The client defaults to the **header**, because a key in a query string leaks into
access logs, CDN logs and `Referer` headers for no benefit. Set
`nextproxy.auth_style` to `query` or `both` if you need the brief's original shape.

Because a key is unnecessary, `nextproxy_is_configured()` deliberately does *not*
require one. Requiring it would report a working integration as broken.

### Response shape

```json
{
  "status": "success",
  "count": 1, "total": 82220, "page": 1, "limit": 1, "totalPages": 82220,
  "proxies": [
    {
      "ip": "2.59.132.39", "port": "3128",
      "type": "https", "protocol": "https",
      "country": "DE", "countryName": "Germany",
      "latency": 196, "speedTier": "Normal", "uptime": "99.8%",
      "anonymity": "anonymous", "status": "active",
      "isProOnly": false, "isLocked": false, "masked": false
    }
  ],
  "totalMatching": 82220,
  "clientTier": "Guest Community Tier (60 req/min)"
}
```

`proxies[]` carries `ip` and `port` as documented. The parser accepts the
documented shape, `data.proxies`, a bare `data` array, a `list` array, `host`
instead of `ip`, nested wrappers, numeric ports and pre-formatted `"ip:port"`
strings — and skips rows flagged `masked` or `isLocked`, since a masked address
is not deliverable.

### Quota and cost

**Correction to an earlier reading of this file.** A first probe concluded the
credit headers were never sent. That was wrong — it was tested without a key.
Credits exist, they are simply **only reported to authenticated callers**:

| | anonymous | with a key |
| --- | --- | --- |
| `x-ratelimit-limit` / `-remaining` / `-reset` | ✅ | ✅ |
| `x-credits-remaining` / `x-credits-used` | ❌ absent | ✅ present |
| tier | `Guest Community Tier (60 req/min)` | `Free Starter Tier (60 req/min · Free Pool Only)` |

The lesson generalises: an unauthenticated probe measures the anonymous tier and
says nothing about what a key unlocks.

**Cost is per request, not per address.** Measured by watching
`x-credits-remaining` across consecutive calls:

| call | credits left | cost |
| --- | --- | --- |
| `/api/proxies?limit=1` | 949 → 948 → 947 → 946 | **1 per call** |
| `/api/proxies?limit=5` | … | **1** |
| `/api/random` | … | **1** |
| `/api/ip` | … | **1** |
| `/api/countries` | … | **1** |
| `/api/health` | no credit headers at all | **free** |

`limit=1` and `limit=100` cost the same, so requesting a bigger page is free
money — do it. `/api/health` is the only genuinely free endpoint, which is why
the storefront's availability check uses it and never the list route: a credit
per page view would drain a fresh 1,000-credit key in about three days. The
sampled admin probe does cost 1 credit, so it is cached for half an hour
(`nextproxy.status_cache_seconds`) and refreshed on demand.

A free key starts with **1,000 credits** — the brief's "1,000 Free Starter
Credits" is real. `x-credits-used` tracked exactly the number of requests made.

**There is still no credits *route*.** `/api/profile`, `/api/credits`, `/api/me`
and `/api/account` all return 404 **even when authenticated**, so the balance has
to come from response headers. `nextproxy.profile_path` stays empty.

The anti-scraping block points at `developer.nextproxy.site` to "register a
verified developer account". **That domain does not resolve.** Treat any signup
flow for it with suspicion, and never paste a key you use elsewhere.

### Masking

The free tier **masks a share of every page**, returning rows like
`185.68.•••.•••:••••`. Measured yield at `limit=25/50/100`: 71–80% of rows are
usable, the rest are masked.

This breaks two naive implementations, both of which were real bugs here:

1. **Short pages are normal.** A full page yields fewer *usable* addresses than
   were requested while 82,000 remain, so paging must compare the **raw** row
   count against the page size, not the usable count. Comparing usable counts
   stopped after page one and short-changed every multi-page order.
2. **`page` is an offset window.** Requests return the same leading rows until
   `page` advances, so it must be sent — and the **page size must stay constant**
   across a walk, or "page 2" of a smaller size re-reads rows page 1 already
   covered. Asking for 25 then 5 makes page 2 = rows 6–10.

Both are covered by `tests/nextproxy-stub.php` (`mask_every`, page windowing) and
asserted in `tests/http.sh`.

### Tier

A free `nex_live_…` key gives **the same 60 requests/minute as no key at all**
(`Free Starter Tier` vs `Guest Community Tier`). What it adds is credit metering
and a balance — not throughput, and not unmasked access. The provider sells a
$5/mo Pro tier; whether that lifts masking or the rate limit was **not verified**
here, and should be treated as unproven until someone tests it.

### What these proxies actually are

The provider describes its pool as "sourced from verified public transit edge
mirrors". In practice this is a **shared, publicly-listed set of mirrored
proxies**, not a private allocation:

- served to anyone, with no key required;
- ~150–250 ms latency (`latency: 196`, `avgLatencyMs: 160–163`);
- `anonymity: "anonymous"`, not `"elite"`;
- the same address can be handed to other callers;
- documented as costing "1 Credit per proxy fetched", but unauthenticated callers
  receive addresses freely, so the metering is not enforced against guests.

**This matters for the catalog.** Three products are wired to this supply:

| Product | Says it is | The pool supplies |
| --- | --- | --- |
| `proxy-9p-10` | "9Proxy Static Residentials", "static residential IPs" | shared datacenter addresses |
| `proxy-mobile-02` | "Mobile 4G Proxies", "dedicated 4G mobile IPs, carrier-grade NAT" | shared datacenter addresses |
| `proxy-dc-03` | "Datacenter Proxies" | shared datacenter addresses ✅ |

Only the third description matches what arrives. Selling the other two from this
pool would misrepresent them, and a buyer routing account logins through an open
mirrored proxy risks having that traffic observed. Either relabel those products
or point them at a provider that genuinely issues dedicated residential/mobile
IPs. The goods themselves are legal to resell; the *description* is the problem.

`proxy-rot-01` ("Rotating Residential Proxies — 5GB") is deliberately **not**
auto-fulfilled: it sells bandwidth through a gateway credential, not a list of
addresses, so an IP list is the wrong product for it.

### The `enabled` default

`nextproxy.enabled` defaults to **false**, so no store silently starts sourcing
customer addresses from a third party. `config.sample.php` sets it to `true` for
anyone following the setup guide, so a configured install behaves as expected.
An earlier revision defaulted to true, which let an unconfigured install — and
the unit test suite itself — call the live API.

---

## smsotp.net (SMS activations)

Left here for the same reason.

The brief's shape (`handler_api.php`) is **not** the real API. The live service is
**API v1.0** at `https://smsotp.net/api/v1`:

```
GET /get-balance?api_key=                  -> {"success":true,"data":{"balance":"99.94"}}
GET /otp/rent?service_id&country_id&…      -> {"success":true,"data":{"phoneNumber":…}}
GET /otp/info?sms_phone_id=                -> {"success":true,"data":{"smsCode":…}}
GET /services?api_key=                     -> {"success":true,"data":[{"id":"tg","name":…}]}
```

Two details that bite:

- **Failures arrive as HTTP 200** with `{"success":false,"message":"…"}`, so the
  status code alone cannot distinguish success from failure.
- `data` is sometimes an object and sometimes a single-element list, and
  `phoneNumber` comes back as a **bare integer** (e.g. `14535336633`), not a
  string and without a country code prefix.
