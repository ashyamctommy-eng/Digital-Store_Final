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

## 2. Install private configuration and admin access

The PHP API stores orders, settings, credentials and inventory as JSON files.
Run the installer from the deployed document root with sudo:

```bash
cd /var/www/digital-hub-shop
sudo bash installer.sh
```

Enter the admin email/password, HTTPS site URL, environment, private data path,
and PHP-FPM user (commonly `www-data`). Use a password of at least 14
characters. The password is entered without echo and stored only as a hash.
The installer writes a small `api/config.php` wrapper and stores the admin
credential file in the private data directory; no provider keys are requested.

The default VPS data path is `/var/lib/digital-hub-shop`, outside the document
root. To change the admin login without changing any other configuration or
data:

```bash
sudo bash installer.sh --reset-admin
```

The installer assigns the private directory to the configured PHP-FPM user and
uses restricted permissions. Do not recursively loosen permissions on the
document root or runtime data.

## 3. Configure Nginx and PHP-FPM

Copy `deploy/vps/nginx.conf` into the Nginx site configuration and replace:

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

## 4. Set permissions and verify

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
