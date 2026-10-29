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
| **PHP 8.2 or newer** | Required by the API and the setup installer |
| PHP extensions: `curl`, `json`, `hash` | Talking to the gateways and signing webhooks. `mbstring` is used if present but not required |
| SSH or the hosting terminal | Run `installer.sh` as the PHP-FPM account (or with sudo) |

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
├── installer.sh       ← creates private runtime config and admin login
└── api/               ← the PHP backend
    ├── .htaccess
    ├── config.sample.php
    ├── lib/
    ├── admin/
    ├── orders/
    ├── palplus/
    ├── nowpayments/
    └── proxies/
```

---

## Step 2 — Run the installer

Open the hosting terminal or connect with SSH, then run the installer from the
document root:

```bash
cd ~/public_html
bash installer.sh
```

The installer asks for the administrator email and password, public HTTPS URL,
environment (`sandbox` or `live`), private data directory, and PHP-FPM user.
Use a password of at least 14 characters. Password entry is hidden; the script
stores only a password hash and writes the admin credentials to the private data
directory. Provider API keys are not requested here.

The data directory must be outside `public_html`. On shared hosting, run the
installer as the same account PHP-FPM uses. If your host requires a separate
system user or root permissions to create that directory, ask the host to
provide a private writable directory before continuing.

To replace only the admin email/password later, run:

```bash
bash installer.sh --reset-admin
```

This preserves the store settings and runtime data.

---

## Step 3 — Verify private storage

The installer creates the external data directory with restricted permissions
and assigns it to PHP-FPM. Do not run recursive `chmod` commands on the site or
data directory. Confirm the owner and permissions from SSH:

```bash
ls -ld /path/printed/by/installer
ls -l /path/printed/by/installer/admin-credentials.json
```

The credential file should be readable only by its owner; the directory should
not be accessible to other users.

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
`php_version` of 8.2 or higher. If the data directory is not writable, correct
the PHP-FPM owner/group on the external directory before continuing.

---

## Step 5 — Configure everything in the console

Open `https://your-domain/admin/` and sign in with the administrator email and
password entered in the installer. Admin access is protected by a server-side
session cookie; the browser does not store an admin API key.

Then choose **Configurations** in the sidebar to add payment and provider
credentials. To change the administrator email/password, run
`bash installer.sh --reset-admin` on the server.

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

## Step 7 — Lock down Firestore (2 minutes, do not skip)

The store does not use Firestore, but your Firebase project still has settings,
and a Firebase project with no rules of its own is a public database. This is
the one step that has nothing to do with the files you just uploaded.

1. Open <https://console.firebase.google.com> → pick the project → **Firestore
   Database → Rules**.
2. Paste the contents of `deploy/cpanel/firestore.rules` from this repo (it
   denies every client read and write) and press **Publish**.
3. Check the existing rules first. If you see

   ```
   allow read, write: if request.time < timestamp.date(2026, ...)
   ```

   you are on the default **test mode** rules. They allow anyone who views your
   page source — your web API key is public — to read and write the whole
   database, and they stop working entirely on the date shown.

**Why "deny everything" is correct here.** Orders used to be mirrored into a
Firestore `orders` collection from the browser, and the admin console read that
collection. That was removed: the browser was supplying the shop's record of a
sale, so a forged document looked like a real order, and the list the admin saw
was not the list the webhooks settled against. Orders now live only in the PHP
ledger you just uploaded, and the admin screens read it through an authenticated
server-side admin session.
Nothing in the store reads or writes Firestore any more, so there is nothing to
grant. Google sign-in still works — Firebase Auth is a separate product and is
unaffected by these rules.

## Step 8 — Load your stock

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

## Step 9 — The one thing no test can do for you

**Run one small real transaction on each gateway.**

Everything is covered by hundreds of automated assertions, but those run against
stubs. Only a real payment proves STK delivery reaches a phone, that the webhook
arrives at your domain, and that the credentials email is accepted. Buy the
cheapest product in your own store, and check:

1. The M-Pesa prompt arrives.
2. The order flips to paid.
3. The credentials appear under **Account → My Orders**.
4. The email arrives (check spam).
5. The external data directory configured by the installer contains a new order file.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Every URL shows the homepage | A blanket SPA rewrite is active. The shipped `.htaccess` deliberately has it commented out; do not enable it |
| Deep links 404, homepage works | `.htaccess` was not uploaded (hidden files were off) or `AllowOverride` is disabled on the host |
| `{"error":"CONFIG_MISSING"}` on every API call | `api/config.php` does not exist — Step 2 |
| `data_dir_writable: false` | Check the external data directory owner and permissions from Step 3 |
| API returns 500 | Check that `config.php` exists and PHP-FPM can read the external data directory; see hPanel → **Advanced → Error Log** |
| "Could not save" in Configurations | The PHP-FPM account cannot write the external data directory |
| Payments fail with `NO_DEFAULT_CHANNEL` | Set a default payment channel in the Palplus console |
| Payments fail with `INSUFFICIENT_SERVICE_BALANCE` | Top up the Palplus service wallet |
| Customer paid, nothing delivered | The webhook URL is wrong, or the NOWPayments IPN secret is missing |
| No order emails | Resend domain not verified — press Test connection |
| Proxies sell but arrive dead | Upload a batch, then use *Test pasted list* before saving |

---

## After launch

- **Back up the external data directory regularly.** It holds the admin hash,
  orders, stock queues, and gateway settings.
- **Keep `api/config.php` private.** The installer creates it; it is not an
  admin login fallback. Use `bash installer.sh --reset-admin` if access is lost.
- **Rotate credentials periodically.** The Palplus console can issue a new key;
  paste it into Configurations and the store switches over without a redeploy.
- **Re-run the bundle check before any future upload** — `npm run verify:bundle`
  refuses to bless a build that contains a key or is missing a file.
- **Re-check Firestore rules after any Firebase console change.** The shipped
  rules deny everything, which is what the store needs; if you ever add a
  collection there, add a rule for it in the same sitting.
