# Upload guide — cPanel / Hostinger hPanel

The complete path from the zip in your downloads folder to a store that can take
money. Follow it in order; each step ends with something you can check.

Uploading is the lower-risk of the two deployment routes: it never deletes
anything, so your order ledger and saved credentials cannot be swept away by a
deploy. (Git deployment is covered in `DEPLOY.md`.)

---

## Before you start

| Need | Why |
| --- | --- |
| Your domain pointing at the hosting | The site is served from the document root |
| **SSL active** (padlock on `https://`) | Palplus rejects plain HTTP callbacks; the `.htaccess` forces HTTPS |
| **PHP 8.0 or newer** (8.1+ is better) | The code uses `match`, `str_contains`, `array_is_list` |
| PHP extensions: `curl`, `json`, `hash` | Talking to the gateways and signing webhooks. `mbstring` is used if present but not required |
| A **new admin key** | Printed below; you will paste it once |

You do not need a database. Orders, stock and settings are JSON files.

---

## Step 1 — Get the files onto the server

1. In hPanel, open **Files → File Manager**.
2. Navigate into your document root. For a main domain this is `public_html/`.
   For a subdomain it is usually `public_html/subdomain-name/` — check
   **Websites → Manage → the document root shown for your site**.
3. Click **Upload** and choose `dist-cpanel.zip`.
4. Back in the file list, right-click the uploaded zip → **Extract** →
   extract into the document root (the current folder).
5. **Delete the zip** afterwards. Leaving it lets anyone download your site's
   source in one file.
6. Turn on **Settings → Show hidden files** (the toggle in the File Manager
   toolbar). You should see `.htaccess` next to `index.html`. If it is missing,
   the site will load but deep links and the API will break.

Your document root should now look like this:

```
public_html/
├── .htaccess          ← must be visible
├── index.html
├── 404.html
├── _next/
├── assets/
├── products/          ← one folder per product page
├── account/
├── admin/
└── api/               ← the PHP backend
    ├── .htaccess
    ├── config.sample.php
    ├── data/
    │   └── inventory/
    ├── lib/
    ├── admin/
    ├── orders/
    ├── palplus/
    ├── nowpayments/
    └── proxies/
```

---

## Step 2 — Create `config.php`

This file is deliberately **not** in the zip: it holds your admin key, and a key
in a shared archive is a key on the internet. You create it once, on the server.

The bundle ships `api/config.sample.php` with every key documented. The quickest
safe route is to copy it and edit two lines.

**Option A — File Manager**

1. Select `api/config.sample.php` → **Copy** → destination `api/config.php`.
2. Right-click `api/config.php` → **Edit**.
3. Change these two values and save:

```php
    // Generate your own; see below.
    'admin_api_key' => 'PASTE_YOUR_GENERATED_KEY',

    // Usually already correct. Leave it unless you are moving the ledger.
    'data_dir' => __DIR__ . '/data',
```

Everything else in that file can stay empty — you will fill it in from the
console in Step 5.

**Generate the admin key.** In hPanel open **Advanced → Terminal**, or use SSH:

```bash
php -r "echo bin2hex(random_bytes(24));"
```

If you have neither, run that line on any machine with PHP, or use a password
manager to generate a 48-character random hex string. **Keep a copy** — it is how
you unlock the configuration screen. It is also the only thing standing between
the internet and your gateway keys, so do not use something guessable.

> Changing `admin_api_key` later means editing this file again. It is
> intentionally impossible to change from the console: a mistyped save there
> would lock you out of the only screen that could fix it.

---

## Step 3 — Set permissions

PHP writes orders, stock and settings into `api/data/`. If it cannot, payments
appear to succeed and then nothing is delivered.

Recommended: **755 on directories, 644 on files.**

**File Manager:** select `api/data` → right-click → **Permissions** → `755` →
tick **Recurse into subdirectories** → apply. Do the same for `api/data/inventory`.

**Terminal / SSH** (from your document root):

```bash
chmod 755 api/data api/data/inventory
find . -type d -exec chmod 755 {} \;
find . -type f -exec chmod 644 {} \;
```

Some shared hosts run PHP as a different user than your cPanel account. If
Step 6 reports the data directory as not writable, use `775` instead of `755`.

---

## Step 4 — Check the site loads

| Check | Expected |
| --- | --- |
| `https://your-domain/` | The storefront, with products |
| `https://your-domain/products/whatsapp-sms-verification-number/` | The product page, in the browser bar with a padlock |
| `http://your-domain/` | Redirects to `https://` |
| `https://your-domain/api/config-status` | A JSON blob, not a 404 or a download |

`config-status` right now will look like this — that is correct at this stage:

```json
{"palplus":{"configured":false,"mode":"sandbox","has_channel":false},
 "nowpayments":{"configured":false,...},
 "public_base_url":"","data_dir_writable":true,"php_version":"8.2.x"}
```

The two things to confirm **now** are `"data_dir_writable":true` and a
`php_version` of 8.0 or higher. If `data_dir_writable` is `false`, go back to
Step 3 — nothing will work until it is true.

---

## Step 5 — Configure everything in the console

Open `https://your-domain/admin/` and sign in with one of the two Google
accounts listed in `ADMIN_EMAILS` (in `src/lib/config.ts`):

- `wildpharmtech9@gmail.com`
- `ashyamctommy@gmail.com`

Then choose **Configurations** in the sidebar. To change who can get in, edit
that list and rebuild.

Paste your admin key when prompted. It is kept in that browser tab only.

Now fill in each section. After every one, press **Test connection** — it checks
against the live provider and tells you what is actually wrong.

### General

| Field | What to enter |
| --- | --- |
| Environment | `sandbox` while testing, `live` when you are ready |
| Store name | Shown in order emails |
| Public site URL | `https://your-domain` — **HTTPS, no trailing slash** |

### Palplus (M-Pesa)

| Field | Where to get it |
| --- | --- |
| API key | Palplus console → **Settings → API Keys** (shown once) |
| Payment channel ID | Palplus console → **Payment Channels**. Optional here, but you **must** set one channel as *default* in their console — otherwise every payment fails with `NO_DEFAULT_CHANNEL` |

Test connection checks four things, and two of them are the failures you cannot
see any other way:

- **Service wallet** — every STK push deducts a fee from it. If it is empty,
  payments fail with `402 INSUFFICIENT_SERVICE_BALANCE`. Top it up in the console.
- **Payment channel** — confirms one can actually be used.

### NOWPayments (crypto)

API key and **IPN secret** (Dashboard → Settings → Payment settings → IPN).
The secret is what proves an incoming webhook really came from them; without it
paid orders are not dispatched.

### Resend (order email)

API key, and a **From** address on a domain you have verified in Resend. The
test reports whether the domain is verified — unverified is the classic silent
failure where Resend accepts the request and nothing is ever delivered.

### SMS provider (optional)

Add the key to buy numbers on demand when your own stock runs out. Without it,
SMS products sell only from numbers you upload.

### Proxy checker

Leave the reflector URL **empty** in production; it defaults to
`https://your-domain/api/proxies/echo`. Test connection confirms your server can
reach its own reflector.

Press **Save changes** when the checklist at the top of the page turns green.

---

## Step 6 — Register the webhooks

Both gateways need to know where to send results. This is the step that is easy
to skip and produces "customer paid, nothing delivered".

| Gateway | Where | Value |
| --- | --- | --- |
| Palplus | Channel settings in their console | `https://your-domain/api/palplus/webhook` |
| NOWPayments | Dashboard → Store settings → IPN | `https://your-domain/api/nowpayments/webhook` |

---

## Step 7 — Load your stock

**Admin → Stock & Credentials.** Pick a product; the form tells you the accepted
format for that kind of product:

- **Credentials** (accounts): one line per unit, `UID|Password|Email`
- **SMS**: `PHONE_NUMBER | INBOX_URL_OR_NOTES` — include the country code
  (`0712345678` is ambiguous)
- **Proxy**: `HOST:PORT`, `USER:PASS@HOST:PORT`, `HOST:PORT:USER:PASS` or
  `HOST:PORT | USER:PASS`

Proxy products also get a **checker**: press *Test pasted list* before saving to
see which addresses actually work, and *Test stock* later to find any that have
gone dead.

Use the preview above the button to confirm the lines parsed before committing.

---

## Step 8 — The one thing no test can do for you

**Run one small real transaction on each gateway.**

Everything is covered by hundreds of automated assertions, but those run against
stubs. Only a real payment proves STK delivery reaches a phone, that the webhook
arrives at your domain, and that the credentials email is accepted. Buy the
cheapest product in your own store, and check:

1. The M-Pesa prompt arrives.
2. The order flips to paid.
3. The credentials appear under **Account → My Orders**.
4. The email arrives (check spam).
5. `api/data/` on the server contains a new order file.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Every URL shows the homepage | A blanket SPA rewrite is active. The shipped `.htaccess` deliberately has it commented out; do not enable it |
| Deep links 404, homepage works | `.htaccess` was not uploaded (hidden files were off) or `AllowOverride` is disabled on the host |
| `{"error":"CONFIG_MISSING"}` on every API call | `api/config.php` does not exist — Step 2 |
| `data_dir_writable: false` | Step 3; try 775 |
| API returns 500 | Almost always a missing `config.php` or an unwritable `api/data`. Check hPanel → **Advanced → Error Log** |
| "Could not save" in Configurations | `api/data` is not writable |
| Payments fail with `NO_DEFAULT_CHANNEL` | Set a default payment channel in the Palplus console |
| Payments fail with `INSUFFICIENT_SERVICE_BALANCE` | Top up the Palplus service wallet |
| Customer paid, nothing delivered | The webhook URL is wrong, or the NOWPayments IPN secret is missing |
| No order emails | Resend domain not verified — press Test connection |
| Proxies sell but arrive dead | Upload a batch, then use *Test pasted list* before saving |

---

## After launch

- **Back up `api/data/` regularly.** It holds every order, the stock queue and
  your gateway settings. A weekly download via File Manager is enough.
- **`api/config.php` is your recovery key.** If the console is ever inaccessible,
  that file still gets you in.
- **Rotate credentials periodically.** The Palplus console can issue a new key;
  paste it into Configurations and the store switches over without a redeploy.
- **Re-run the bundle check before any future upload** — `npm run verify:bundle`
  refuses to bless a build that contains a key or is missing a file.
- **Publish Firestore security rules.** The admin *pages* are gated in the
  browser, and every admin *API* call additionally requires the admin key — but
  the storefront also mirrors orders into a Firestore `orders` collection from
  the browser. If that Firebase project is still on the default test rules,
  anyone can read every order and write fake ones. Scope the rules to the two
  addresses above, or stop mirroring orders to Firestore (the PHP ledger is the
  source of truth).
