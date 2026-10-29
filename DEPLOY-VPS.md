# Deploying Outlawz Store to a VPS

This repository exports a static Next.js storefront and serves its PHP payment
API separately. Production serves static files through Nginx + PHP-FPM; it does
not run the Next.js development server.

## 1. Prepare the VPS

The canonical store domain is `https://outlawz.tech`. Confirm it resolves to
this VPS and that inbound TCP ports 80 and 443 are open in both the VPS and
provider firewalls. The installer checks DNS and requests TLS but does not edit
registrar DNS.

Use Debian/Ubuntu with PHP 8.2+ and Node.js 24 available. Install Git, rsync,
and PHP CLI tools:

```bash
sudo apt-get update
sudo apt-get install -y git rsync php-cli php-curl
node --version   # must report v24.x
php -v           # must report 8.2 or newer
```

If Node.js 24 is not installed, install it using the instructions at
[nodejs.org/en/download](https://nodejs.org/en/download). Use a Debian/Ubuntu
package source that provides PHP 8.2 or newer; the VPS installer also checks
this requirement before configuring PHP-FPM.

## 2. Clone and build the project

Clone the public repository on the VPS, install the locked dependencies, and
run the verification/build script:

```bash
git clone https://github.com/ashyamctommy-eng/Digital-Store_Final.git \
  "$HOME/outlawz-store-source"
cd "$HOME/outlawz-store-source"
npm ci
npm run verify
```

`npm run verify` runs type checks, lint, PHP tests, and creates/verifies the
production bundle in `dist/`. Do not copy `.git`, `node_modules`, `.env` files,
or development secrets into the public document root.

## 3. Install Outlawz Store

Deploy the bundle to the web root. The excludes preserve server-only API config
and runtime files during both the first install and later updates:

```bash
sudo install -d -m 0755 /var/www/outlawz-store
sudo rsync -a --delete \
  --exclude='/api/config.php' \
  --exclude='/api/data/' \
  dist/ /var/www/outlawz-store/
cd /var/www/outlawz-store
sudo bash installer.sh
```

When prompted, enter `outlawz.tech` (without `www`), then the admin email and a
password of at least 14 characters. The installer sets the public URL to
`https://outlawz.tech`, names the store **Outlawz Store**, chooses
`/var/lib/digital-hub-shop` for private storage, detects PHP-FPM, and configures
Nginx plus a Let's Encrypt certificate. Missing Nginx, PHP-FPM, or Certbot
packages are installed automatically; active UFW firewalls get ports 80 and
443 opened. Only a password hash is stored.

Live mode is the default. Live payment credentials can process real transactions.
To start in test mode, append `--sandbox` to the first installer command; after
setup, change the mode in Admin → Configurations. Enter the canonical hostname
before the first installation; the installer configures one hostname.

After installation, sign in at `https://outlawz.tech/admin/`. Add payment,
Resend, GhostProxies, and Novita credentials under Admin → Configurations.
Replit Secrets do not transfer to the VPS. Verify `orders@outlawz.tech` in
Resend before sending transactional email.

The installer does not change DNS. It refuses to replace unmanaged Nginx site
config and blocks public access to `installer.sh`, API config, and runtime data.
On non-Debian/Ubuntu systems or when the host manages Nginx/TLS, use
`bash installer.sh --app-only` and configure the web server with
`$HOME/outlawz-store-source/deploy/vps/nginx.conf`.

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

- `DOMAIN` with `outlawz.tech`.
- `WEB_ROOT` with `/var/www/outlawz-store`.
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

- `https://outlawz.tech/` loads the storefront and shows Outlawz Store branding.
- `https://outlawz.tech/api/config-status` returns JSON and reports
  `data_dir_writable: true`.
- `https://outlawz.tech/api/data/` and `https://outlawz.tech/api/config.php` return 403 or
  404, never file contents.
- `https://outlawz.tech/admin/` accepts the email/password configured by `installer.sh`.
- `npm run verify` passed before deployment.

Register the Palplus and NOWPayments callbacks using the `https://outlawz.tech` URLs in
`DEPLOY.md`. Configure provider credentials in the admin Configurations page;
the saved secret values remain server-side.

For Novita product-description drafts, configure both `NOVITA_API_KEY` and
`NOVITA_MODEL` on the VPS, or enter them in Super Admin → Configurations after
deployment. Replit Secrets do not transfer to a separate VPS. Keep the key
outside the static release and restrict access to the admin panel. Draft
generation is limited to 20 requests per hour; descriptions remain editable
and are not saved until an admin submits the product form.

## 6. Backups and updates

Back up `/var/lib/digital-hub-shop` separately from static releases. It contains
the admin password hash, order ledger, settings, and stock queues. Before
replacing files during an update, preserve this data directory and `api/config.php`;
neither belongs in a fresh release bundle.

Update the clone and deploy the refreshed bundle to the existing document root:

```bash
cd "$HOME/outlawz-store-source"
git pull --ff-only
npm ci
npm run verify
sudo rsync -a --delete \
  --exclude='/api/config.php' \
  --exclude='/api/data/' \
  dist/ /var/www/outlawz-store/
```

The excludes preserve server configuration and runtime files while removing
stale static build files. Do not delete the external data directory. Re-run
`installer.sh` only for a new installation; use `--reset-admin` to change the
administrator login.
