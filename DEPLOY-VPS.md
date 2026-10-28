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

## 2. Keep runtime data private

The PHP API stores orders, settings and inventory as JSON files. For production,
place the data directory outside the Nginx document root and set `data_dir` in
`api/config.php` to that absolute path:

```php
'data_dir' => '/var/lib/digital-hub-shop',
```

Create the directory and grant write access to the PHP-FPM user only. For
example, if PHP-FPM runs as `www-data`:

```bash
sudo install -d -o www-data -g www-data -m 0750 /var/lib/digital-hub-shop
sudo install -d -o www-data -g www-data -m 0750 /var/lib/digital-hub-shop/inventory
```

Copy `api/config.sample.php` to `api/config.php`, then set `admin_api_key`,
`data_dir`, and the HTTPS `public_base_url`. Keep `config.php` readable only by
the deployment account and PHP-FPM user; never commit it or put it in a release
archive.

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
- `/admin/` loads and accepts the configured admin key.
- `npm run test:php` and `npm run verify` passed before upload.

Register the Palplus and NOWPayments callbacks using the exact HTTPS URLs in
`DEPLOY.md`. Configure provider credentials in the admin Configurations page;
the saved secret values remain server-side.

## 5. Backups and updates

Back up `/var/lib/digital-hub-shop` separately from static releases. It contains
the order ledger, settings, and stock queues. Before replacing files during an
update, preserve this data directory and `api/config.php`; neither belongs in a
fresh release bundle.

Build a new `dist/` and deploy it as a release directory, then switch the
Nginx document root or symlink to the new release. Do not delete or overwrite
the persistent data directory as part of a code deploy.
