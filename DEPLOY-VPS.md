# Deploying Digital Hub Shop to a VPS

This repository exports a static Next.js storefront and serves its PHP payment
API separately. The VPS does not need a running Next.js process in production.
The guide below assumes Nginx + PHP-FPM; it can be adapted to Apache if the host
already uses it.

## 1. Build the release bundle

On a machine with Node.js 24 and PHP 8.2 available:

```bash
npm ci
npm run verify
npm run build:cpanel
```

The deployable site and API are assembled in `dist/`. Upload the **contents** of
that directory to the VPS document root, for example `/var/www/digital-hub-shop`.
Do not upload `node_modules`, `.git`, source maps, or a development `.env` file.

## 2. Point the domain at the VPS

Create an `A` record for the domain pointing to the VPS public IPv4 address.
If the domain uses IPv6, add an `AAAA` record only when the VPS has working
IPv6. Wait for public DNS to resolve to this server. Ensure inbound TCP ports
80 and 443 are reachable through both the VPS firewall and provider firewall.

The installer configures the domain you enter as the canonical hostname. For a
`www` address, enter the exact hostname you want customers to use.

## 3. Install the app, web server, and HTTPS

The PHP API stores orders, settings, credentials and inventory as JSON files.
On a Debian/Ubuntu VPS, run the installer as root from the deployed document
root:

```bash
cd /var/www/digital-hub-shop
sudo bash installer.sh
```

The installer asks for the domain and administrator email/password. It
automatically sets the public HTTPS URL, uses live payment mode, chooses
`/var/lib/digital-hub-shop` for private storage, detects PHP-FPM, and configures
Nginx and a Let's Encrypt certificate. Missing Nginx, PHP-FPM, or Certbot
packages are installed automatically. If UFW is active, ports 80 and 443 are
allowed. Use a password of at least 14 characters; password entry is hidden
and only a one-way hash is stored.

Live mode uses production payment gateways once their credentials are added.
Choose `--sandbox` until you are ready to accept real transactions.

Use `--sandbox` instead of live mode while testing:

```bash
sudo bash installer.sh --sandbox
```

The installer creates the Nginx site using the uploaded document root. It
refuses to replace an unmanaged site config; installer-managed configs are
backed up on re-run. It creates `api/config.php` and the private admin
credential file. Provider API keys are added later in Admin → Configurations.
The default email sender uses `orders@<domain>`; verify that sender domain with
Resend before sending order emails.

On non-Debian/Ubuntu systems or when Nginx/TLS are already managed by your host,
run `bash installer.sh --app-only` and configure the web server using
`deploy/vps/nginx.conf`. The installer never edits DNS records; DNS must be
pointed at the VPS before automatic certificate issuance.

The default VPS data path is `/var/lib/digital-hub-shop`, outside the document
root. To change the admin login without changing any other configuration or
data:

```bash
sudo bash installer.sh --reset-admin
```

The installer assigns the private directory to the detected PHP-FPM user and
uses restricted permissions. Do not recursively loosen permissions on the
document root or runtime data.

## 4. Manual Nginx setup

Skip this section if the installer configured Nginx and HTTPS. For
`--app-only`, copy `deploy/vps/nginx.conf` into the Nginx site configuration
and replace:

- `DOMAIN` with the purchased domain.
- `WEB_ROOT` with the deployed `dist` directory.
- `PHP_FPM_SOCKET` with the socket for the installed PHP-FPM version, such as
  `/run/php/php8.2-fpm.sock`.
- The certificate paths with the paths created by Certbot or your TLS provider.

The extensionless `/api/...` routes must resolve to their matching `.php` files.
The example also blocks HTTP access to runtime data and configuration files.
Enable the site, validate it with `nginx -t`, and reload Nginx.

Install PHP 8.2+ with `curl`, `json`, and `hash` extensions, then enable and
start PHP-FPM. Exact package names vary by VPS distribution.

## 5. Verify the deployment

The static files should be readable by Nginx. The only writable production
directory should be the external data directory described above. Confirm:

- `https://DOMAIN/` loads the storefront.
- `https://DOMAIN/api/config-status` returns JSON and reports
  `data_dir_writable: true`.
- `https://DOMAIN/api/data/` and `https://DOMAIN/api/config.php` return 403 or
  404, never file contents.
- `/admin/` accepts the email/password configured by `installer.sh`.
- `npm run test:php` and `npm run verify` passed before upload.

Register the Palplus and NOWPayments callbacks using the exact HTTPS URLs in
`DEPLOY.md`. Configure provider credentials in the admin Configurations page;
the saved secret values remain server-side.

For Novita product-description drafts, configure both `NOVITA_API_KEY` and
`NOVITA_MODEL` on the VPS, or enter them in Super Admin → Configurations after
deployment. Replit Secrets do not transfer to a separate VPS. Keep the key
outside the static release and restrict access to the admin panel. Draft
generation is limited to 20 requests per hour; descriptions remain editable
and are not saved until an admin submits the product form.

## 5. Backups and updates

Back up `/var/lib/digital-hub-shop` separately from static releases. It contains
the admin password hash, order ledger, settings, and stock queues. Before
replacing files during an update, preserve this data directory and `api/config.php`;
neither belongs in a fresh release bundle.

Build a new `dist/` and deploy it as a release directory, then switch the
Nginx document root or symlink to the new release. Do not delete or overwrite
the persistent data directory as part of a code deploy.
