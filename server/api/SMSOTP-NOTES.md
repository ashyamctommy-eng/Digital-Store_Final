# Provider notes — verified against the live service

These notes exist because the implementation brief and the provider's own
documentation disagreed with reality in a way that would have produced dead code.
Everything below was checked against the live API on 2026-09-19. Re-verify before
trusting a detail; providers change.

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
