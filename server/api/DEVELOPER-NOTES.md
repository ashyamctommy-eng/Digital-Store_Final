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

### Quota: rate-limit headers, not credits

The documented `X-Credits-Remaining` / `X-Credits-Used` headers are **never
sent**. What is really returned:

```
x-ratelimit-limit: 60
x-ratelimit-remaining: 48
x-ratelimit-reset: 1789828200
```

The admin console therefore reports **"Requests left"** from those headers, and
shows `credits_remaining` as `n/a` unless a real credits source exists. It does
not invent a balance. If your account is ever given a genuine credits endpoint,
set `nextproxy.profile_path` and that value is preferred.

The brief mentioned "1,000 Free Starter Credits" and a developer console, and the
anti-scraping block points at `developer.nextproxy.site`. **That domain does not
resolve.** Treat any signup flow for it with suspicion, and never paste a key you
use elsewhere.

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
