#!/usr/bin/env bash
# Interactive, secret-safe bootstrap for a fresh Outlawz Store deployment.
set -euo pipefail
umask 077

RESET_ADMIN=0
APP_ONLY=0
MODE="${DHS_MODE:-live}"
while (($#)); do
  case "$1" in
    --reset-admin)
      RESET_ADMIN=1
      ;;
    --app-only)
      APP_ONLY=1
      ;;
    --sandbox)
      MODE="sandbox"
      ;;
    --live)
      MODE="live"
      ;;
    --help|-h)
      cat <<'HELP'
Usage:
  sudo bash installer.sh                 Configure app, Nginx, and HTTPS
  sudo bash installer.sh --sandbox       Configure gateways for testing
  bash installer.sh --app-only           Skip automatic VPS web-server setup
  sudo bash installer.sh --reset-admin   Replace only the admin email/password

Fresh install asks for the domain and administrator email/password. Other app
settings use production defaults; provider keys are entered in Admin → Configurations.
On supported Debian/Ubuntu VPSes, root installs Nginx/PHP-FPM/Certbot and requests
a Let's Encrypt certificate. DNS must already point at this VPS and ports 80/443
must be reachable. Use --app-only on shared hosting or an already-managed web server.

The installer never accepts a password in command-line arguments and never
stores plaintext passwords.
HELP
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done
if [[ "$MODE" != "sandbox" && "$MODE" != "live" ]]; then
  echo "DHS_MODE must be 'sandbox' or 'live'." >&2
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/api/config.sample.php" ]]; then
  API_DIR="$SCRIPT_DIR/api"
elif [[ -f "$SCRIPT_DIR/server/api/config.sample.php" ]]; then
  API_DIR="$SCRIPT_DIR/server/api"
else
  echo "Could not find api/config.sample.php or server/api/config.sample.php." >&2
  exit 1
fi

SAMPLE_FILE="$API_DIR/config.sample.php"
CONFIG_FILE="$API_DIR/config.php"
if [[ "$RESET_ADMIN" -eq 1 && ! -f "$CONFIG_FILE" ]]; then
  echo "No config.php exists yet. Run the installer without --reset-admin first." >&2
  exit 1
fi
if [[ "$RESET_ADMIN" -eq 0 && -f "$CONFIG_FILE" ]]; then
  echo "config.php already exists; it was left unchanged." >&2
  echo "Use --reset-admin to change only the admin email and password." >&2
  exit 1
fi

prompt() {
  local label="$1" default="${2:-}" value
  if [[ -n "$default" ]]; then
    read -r -p "$label [$default]: " value || true
    printf '%s' "${value:-$default}"
  else
    read -r -p "$label: " value || true
    printf '%s' "$value"
  fi
}

normalize_domain() {
  local input="$1"
  input="${input%/}"
  if [[ "$input" == https://* ]]; then
    input="${input#https://}"
  elif [[ "$input" == http://* ]]; then
    echo "Use the domain name without http://, or enter its https:// URL." >&2
    return 1
  fi
  input="${input,,}"
  if [[ "$input" == */* || "$input" == *:* || "$input" == *'?'* || "$input" == *'#'* || "$input" == *@* ]]; then
    echo "Enter only a hostname, such as shop.example.com." >&2
    return 1
  fi
  if [[ ! "$input" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] \
      || [[ "$input" =~ ^[0-9.]+$ ]]; then
    echo "Enter a valid public domain name, such as shop.example.com." >&2
    return 1
  fi
  printf '%s' "$input"
}

detect_php_user() {
  local user=""
  if [[ -n "${DHS_PHP_FPM_USER:-}" ]]; then
    user="$DHS_PHP_FPM_USER"
  elif [[ "$EUID" -ne 0 ]]; then
    user="$(id -un)"
  else
    local pool candidate
    for pool in /etc/php/*/fpm/pool.d/*.conf /etc/php-fpm.d/*.conf; do
      [[ -f "$pool" ]] || continue
      candidate="$(awk -F= '/^[[:space:]]*user[[:space:]]*=/{gsub(/[[:space:]]/, "", $2); print $2; exit}' "$pool")"
      if [[ -n "$candidate" ]]; then
        user="$candidate"
        break
      fi
    done
    if [[ -z "$user" ]] && command -v ps >/dev/null 2>&1; then
      user="$(ps -eo user=,comm= | awk '$2 ~ /^php-fpm/ && $1 != "root" {print $1; exit}')"
    fi
    if [[ -z "$user" ]]; then
      for candidate in www-data nginx apache; do
        if getent passwd "$candidate" >/dev/null 2>&1; then
          user="$candidate"
          break
        fi
      done
    fi
  fi
  if [[ -z "$user" ]] || ! getent passwd "$user" >/dev/null 2>&1; then
    echo "Could not detect the PHP-FPM user. Set DHS_PHP_FPM_USER and rerun." >&2
    return 1
  fi
  printf '%s' "$user"
}

prepare_vps_stack() {
  VPS_SETUP=0
  if [[ "$APP_ONLY" -eq 1 || "$EUID" -ne 0 ]]; then
    return 0
  fi

  if [[ ! -r /etc/os-release ]]; then
    echo "Cannot identify this VPS operating system. Use --app-only for an existing web server." >&2
    return 1
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "debian" && "${ID:-}" != "ubuntu" ]]; then
    echo "Automatic Nginx/Certbot setup supports Debian and Ubuntu. Use --app-only on this OS." >&2
    return 1
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "apt-get is required for automatic Debian/Ubuntu setup." >&2
    return 1
  fi

  local missing=0 package fpm_unit php_version
  for package in nginx php-fpm php-cli php-curl certbot python3-certbot-nginx; do
    if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      missing=1
    fi
  done
  if [[ "$missing" -eq 1 ]]; then
    echo "Installing required Nginx, PHP-FPM, and Certbot packages..."
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
      nginx php-fpm php-cli php-curl certbot python3-certbot-nginx
  fi

  if ! command -v php >/dev/null 2>&1 || ! php -r 'exit(PHP_VERSION_ID >= 80200 ? 0 : 1);'; then
    echo "PHP 8.2 or newer is required. Install a supported PHP version, then rerun." >&2
    return 1
  fi
  systemctl enable --now nginx
  php_version="$(php -r 'echo PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION;')"
  fpm_unit="php${php_version}-fpm.service"
  if ! systemctl cat "$fpm_unit" >/dev/null 2>&1; then
    fpm_unit="$(systemctl list-unit-files --type=service --no-legend 'php*-fpm.service' 2>/dev/null | awk 'NR==1 {print $1}')"
  fi
  if [[ -z "$fpm_unit" ]]; then
    echo "Could not find a PHP-FPM service after package installation." >&2
    return 1
  fi
  systemctl enable --now "$fpm_unit"
  PHP_FPM_SOCKET="${DHS_PHP_FPM_SOCKET:-/run/php/php${php_version}-fpm.sock}"
  if [[ -z "$PHP_FPM_SOCKET" || ! -S "$PHP_FPM_SOCKET" ]]; then
    echo "Could not find the PHP-FPM socket for the installed PHP version." >&2
    echo "Set DHS_PHP_FPM_SOCKET to the correct socket path and rerun." >&2
    return 1
  fi
  PHP_USER="$(detect_php_user)"
  PHP_GROUP="$(id -gn "$PHP_USER")"
  VPS_SETUP=1
}

configure_nginx() {
  [[ "${VPS_SETUP:-0}" -eq 1 ]] || return 0

  local site_name="digital-hub-shop-${DOMAIN}.conf"
  local sites_available="/etc/nginx/sites-available"
  local sites_enabled="/etc/nginx/sites-enabled"
  local site_file="$sites_available/$site_name"
  local enabled_file="$sites_enabled/$site_name"
  local backup_file="" had_enabled=0
  local root_escaped

  if [[ -L "$site_file" ]]; then
    echo "Refusing to replace symlinked Nginx config: $site_file" >&2
    return 1
  fi
  if [[ -e "$site_file" ]] && ! grep -q 'Managed by Digital Hub Shop installer' "$site_file"; then
    echo "Refusing to replace unmanaged Nginx config: $site_file" >&2
    echo "Back it up or use --app-only to keep your existing web-server setup." >&2
    return 1
  fi
  if [[ -e "$enabled_file" ]]; then
    if [[ ! -L "$enabled_file" || "$(readlink -f "$enabled_file")" != "$(realpath -m "$site_file")" ]]; then
      echo "Refusing to replace existing Nginx site entry: $enabled_file" >&2
      return 1
    fi
    had_enabled=1
  fi
  if [[ -f "$site_file" ]]; then
    backup_file="${site_file}.backup.$(date +%Y%m%d%H%M%S)"
    cp -p -- "$site_file" "$backup_file"
    echo "Existing installer-managed Nginx config backed up to $backup_file"
  fi

  root_escaped="$(printf '%s' "$SCRIPT_DIR_REAL" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  NGINX_TMP="$(mktemp "$sites_available/.digital-hub-shop.XXXXXX")"
  cat >"$NGINX_TMP" <<NGINX
# Managed by Digital Hub Shop installer. Local edits are replaced on reinstall.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    root "$root_escaped";
    index index.html;
    client_max_body_size 8m;

    location = /installer.sh { return 404; }
    location ^~ /api/data/ { deny all; }
    location ~* ^/api/config(\\.sample)?\\.php$ { deny all; }
    location ~ /\\.(?!well-known) { deny all; }

    location /api/ {
        try_files \$uri \$uri/ \$uri.php =404;
    }

    location ~ \\.php$ {
        try_files \$uri =404;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param HTTPS on;
        fastcgi_pass unix:$PHP_FPM_SOCKET;
    }

    location / {
        try_files \$uri \$uri/ \$uri.html =404;
    }

    location ~* \\.(?:css|js|png|jpg|jpeg|gif|svg|webp|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }
}
NGINX
  chmod 0644 "$NGINX_TMP"
  mv -f -- "$NGINX_TMP" "$site_file"
  NGINX_TMP=""
  if [[ "$had_enabled" -eq 0 ]]; then
    ln -s "$site_file" "$enabled_file"
  fi

  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow 80/tcp >/dev/null || true
    ufw allow 443/tcp >/dev/null || true
  fi

  rollback_nginx() {
    if [[ -n "$backup_file" && -f "$backup_file" ]]; then
      cp -p -- "$backup_file" "$site_file"
    else
      rm -f -- "$site_file"
    fi
    if [[ "$had_enabled" -eq 0 ]]; then
      rm -f -- "$enabled_file"
    fi
    nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
  }

  if ! nginx -t; then
    echo "Nginx rejected the generated site config; restoring the previous setup." >&2
    rollback_nginx
    return 1
  fi
  if ! systemctl reload nginx; then
    echo "Could not reload Nginx; restoring the previous site config." >&2
    rollback_nginx
    return 1
  fi

  local certbot_status=0
  certbot --nginx --non-interactive --agree-tos --email "$ADMIN_EMAIL" --redirect -d "$DOMAIN" || certbot_status=$?
  if [[ "$certbot_status" -ne 0 ]]; then
    echo "Let's Encrypt could not issue a certificate for $DOMAIN." >&2
    echo "Check DNS, the VPS firewall, and inbound ports 80/443; restoring the previous Nginx config." >&2
    rollback_nginx
    return 1
  fi
  if ! nginx -t; then
    echo "Nginx config failed after certificate setup; restoring the previous config." >&2
    rollback_nginx
    return 1
  fi
  if ! systemctl reload nginx; then
    echo "Could not reload Nginx after certificate setup; restoring the previous config." >&2
    rollback_nginx
    return 1
  fi
  echo "Nginx is serving https://$DOMAIN with a Let's Encrypt certificate."
}

if [[ "$RESET_ADMIN" -eq 1 ]]; then
  if ! command -v php >/dev/null 2>&1 || ! php -r 'exit(PHP_VERSION_ID >= 80200 ? 0 : 1);'; then
    echo "PHP CLI 8.2 or newer is required to reset the administrator login." >&2
    exit 1
  fi
  DATA_DIR="$(php -r '$c = require $argv[1]; $d = $c["data_dir"] ?? ""; echo is_string($d) ? $d : "";' "$CONFIG_FILE")"
  if [[ -z "$DATA_DIR" || "$DATA_DIR" != /* ]]; then
    echo "config.php must contain an absolute data_dir before admin credentials can be reset." >&2
    exit 1
  fi
  if [[ ! -d "$DATA_DIR" ]]; then
    echo "The configured data_dir does not exist; it was left unchanged." >&2
    exit 1
  fi
  PHP_USER="$(stat -c '%u' "$DATA_DIR")"
  PHP_GROUP="$(stat -c '%g' "$DATA_DIR")"
  if [[ "$EUID" -ne 0 && "$PHP_USER" != "$EUID" ]]; then
    echo "Run this installer with sudo to replace credentials owned by the PHP-FPM user." >&2
    exit 1
  fi
  ADMIN_EMAIL="${DHS_ADMIN_EMAIL:-$(prompt 'Administrator email')}"
else
  DOMAIN_INPUT="${DHS_DOMAIN:-$(prompt 'Primary domain (for example shop.example.com or https://shop.example.com)')}"
  DOMAIN="$(normalize_domain "$DOMAIN_INPUT")" || exit 1
  PUBLIC_BASE_URL="https://$DOMAIN"
  ADMIN_EMAIL="${DHS_ADMIN_EMAIL:-$(prompt 'Administrator email')}"
  if [[ "$EUID" -eq 0 ]]; then
    DEFAULT_DATA_DIR="/var/lib/digital-hub-shop"
  else
    DEFAULT_DATA_DIR="${HOME:-/tmp}/.local/share/digital-hub-shop"
  fi
  DATA_DIR="${DHS_DATA_DIR:-$DEFAULT_DATA_DIR}"
  if [[ "$DATA_DIR" != /* ]]; then
    echo "DHS_DATA_DIR must be an absolute path." >&2
    exit 1
  fi
  if [[ "$DATA_DIR" == "$SCRIPT_DIR" || "$DATA_DIR" == "$SCRIPT_DIR/"* ]]; then
    echo "The private data directory must be outside the application and web root." >&2
    exit 1
  fi

  if [[ "$EUID" -eq 0 && "$APP_ONLY" -eq 0 ]] && ! getent ahosts "$DOMAIN" >/dev/null 2>&1; then
    echo "No public DNS record was found for '$DOMAIN'." >&2
    echo "Point the domain at this VPS, wait for DNS to propagate, then rerun." >&2
    exit 1
  fi

  prepare_vps_stack
  if [[ "${VPS_SETUP:-0}" -eq 0 ]]; then
    PHP_USER="$(detect_php_user)"
    PHP_GROUP="$(id -gn "$PHP_USER")"
    if ! command -v php >/dev/null 2>&1; then
      echo "PHP CLI is required. On shared hosting, enable PHP 8.2+ or run with --app-only." >&2
      exit 1
    fi
    if ! php -r 'exit(PHP_VERSION_ID >= 80200 ? 0 : 1);'; then
      echo "PHP 8.2 or newer is required." >&2
      exit 1
    fi
  fi
fi

if [[ "$RESET_ADMIN" -eq 1 && ! -d "$DATA_DIR" ]]; then
  echo "The configured data directory does not exist." >&2
  exit 1
fi
DATA_DIR_REAL="$(realpath -m -- "$DATA_DIR")"
SCRIPT_DIR_REAL="$(realpath -- "$SCRIPT_DIR")"
if [[ "$DATA_DIR_REAL" == "$SCRIPT_DIR_REAL" || "$DATA_DIR_REAL" == "$SCRIPT_DIR_REAL/"* ]]; then
  echo "The resolved data directory is inside the application/web root; choose an external path." >&2
  exit 1
fi
if [[ "$RESET_ADMIN" -eq 0 && -f "$DATA_DIR_REAL/admin-credentials.json" ]]; then
  echo "Admin credentials already exist in that data directory; refusing to overwrite them." >&2
  echo "Choose the existing installation's --reset-admin flow instead." >&2
  exit 1
fi

if ! php -r 'exit(filter_var($argv[1], FILTER_VALIDATE_EMAIL) !== false ? 0 : 1);' "$ADMIN_EMAIL"; then
  echo "Enter a valid administrator email address." >&2
  exit 1
fi

read -r -s -p 'Administrator password (14+ characters): ' ADMIN_PASSWORD
printf '\n'
read -r -s -p 'Confirm administrator password: ' ADMIN_PASSWORD_CONFIRM
printf '\n'
if [[ "${#ADMIN_PASSWORD}" -lt 14 ]]; then
  echo "Use a password with at least 14 characters." >&2
  unset ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM
  exit 1
fi
if [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]]; then
  echo "The passwords do not match." >&2
  unset ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM
  exit 1
fi

if [[ "$RESET_ADMIN" -eq 0 ]]; then
  if [[ "$EUID" -eq 0 ]]; then
    install -d -o "$PHP_USER" -g "$PHP_GROUP" -m 0750 "$DATA_DIR"
    install -d -o "$PHP_USER" -g "$PHP_GROUP" -m 0750 "$DATA_DIR/inventory"
  else
    mkdir -p "$DATA_DIR/inventory"
    chmod 0750 "$DATA_DIR" "$DATA_DIR/inventory"
  fi
fi

CONFIG_TMP=""
CREDENTIALS_TMP=""
NGINX_TMP=""
cleanup() {
  [[ -n "${CONFIG_TMP:-}" && -f "${CONFIG_TMP:-}" ]] && rm -f -- "$CONFIG_TMP"
  [[ -n "${CREDENTIALS_TMP:-}" && -f "${CREDENTIALS_TMP:-}" ]] && rm -f -- "$CREDENTIALS_TMP"
  [[ -n "${NGINX_TMP:-}" && -f "${NGINX_TMP:-}" ]] && rm -f -- "$NGINX_TMP"
  unset ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM
}
trap cleanup EXIT

if [[ "$RESET_ADMIN" -eq 0 ]]; then
  configure_nginx
fi

if [[ "$RESET_ADMIN" -eq 0 ]]; then
  CONFIG_TMP="$(mktemp "$API_DIR/.config.php.tmp.XXXXXX")"
  chmod 0600 "$CONFIG_TMP"
fi
CREDENTIALS_TMP="$(mktemp "$DATA_DIR/.admin-credentials.tmp.XXXXXX")"
chmod 0600 "$CREDENTIALS_TMP"

printf '%s' "$ADMIN_PASSWORD" | php -r '
  $password = stream_get_contents(STDIN);
  if (!is_string($password) || strlen($password) < 14) {
      fwrite(STDERR, "Password input was invalid.\n");
      exit(1);
  }
  $email = strtolower(trim($argv[1]));
  $dataDir = $argv[2];
  $reset = $argv[3] === "1";
  $configTmp = $argv[4];
  $configPath = $argv[5];
  $samplePath = $argv[6];
  $credentialsTmp = $argv[7];
  $publicBaseUrl = $argv[8];
  $mode = $argv[9];

  $credentials = [
      "email" => $email,
      "password_hash" => password_hash($password, PASSWORD_DEFAULT),
      "updated_at" => gmdate(DATE_ATOM),
  ];
  $json = json_encode($credentials, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
  if (!is_string($json) || file_put_contents($credentialsTmp, $json . PHP_EOL, LOCK_EX) === false) {
      fwrite(STDERR, "Could not write private admin credentials.\n");
      exit(1);
  }
  chmod($credentialsTmp, 0600);

  if (!$reset) {
      $config = require $samplePath;
      $configCode = "<?php\n"
          . "// Generated by installer.sh. Keep this file private and out of Git.\n"
          . "$" . "config = require __DIR__ . \"/config.sample.php\";\n"
          . "$" . "config[\"mode\"] = " . var_export($mode, true) . ";\n"
          . "$" . "config[\"public_base_url\"] = " . var_export(rtrim($publicBaseUrl, "/"), true) . ";\n"
          . "$" . "config[\"resend\"][\"from\"] = " . var_export("Outlawz Store <orders@" . preg_replace("/^www\\./i", "", (string) parse_url($publicBaseUrl, PHP_URL_HOST)) . ">", true) . ";\n"
          . "$" . "config[\"data_dir\"] = " . var_export($dataDir, true) . ";\n"
          . "return $" . "config;\n";
      if (file_put_contents($configTmp, $configCode, LOCK_EX) === false) {
          fwrite(STDERR, "Could not write config.php.\n");
          exit(1);
      }
      chmod($configTmp, 0640);
      if (!rename($configTmp, $configPath)) {
          fwrite(STDERR, "Could not install config.php.\n");
          exit(1);
      }
  }

  if (!rename($credentialsTmp, $dataDir . "/admin-credentials.json")) {
      fwrite(STDERR, "Could not install private admin credentials.\n");
      exit(1);
  }
  chmod($dataDir . "/admin-credentials.json", 0600);
' "$ADMIN_EMAIL" "$DATA_DIR_REAL" "$RESET_ADMIN" "${CONFIG_TMP:-}" "$CONFIG_FILE" "$SAMPLE_FILE" "$CREDENTIALS_TMP" "${PUBLIC_BASE_URL:-}" "${MODE:-}" || {
  echo "Setup failed; temporary files will be removed." >&2
  exit 1
}

if [[ "$EUID" -eq 0 ]]; then
  chown "$PHP_USER:$PHP_GROUP" "$DATA_DIR" "$DATA_DIR/admin-credentials.json"
  if [[ -d "$DATA_DIR/inventory" ]]; then
    chown "$PHP_USER:$PHP_GROUP" "$DATA_DIR/inventory"
    chmod 0750 "$DATA_DIR/inventory"
  fi
  chmod 0600 "$DATA_DIR/admin-credentials.json"
  if [[ "$RESET_ADMIN" -eq 0 ]]; then
    chown root:"$PHP_GROUP" "$CONFIG_FILE"
    chmod 0640 "$CONFIG_FILE"
  fi
else
  chmod 0600 "$DATA_DIR/admin-credentials.json"
fi

php -l "$CONFIG_FILE" >/dev/null
printf '%s' "$ADMIN_PASSWORD" | php -r '
  $config = require $argv[1];
  $path = rtrim((string) ($config["data_dir"] ?? ""), "/") . "/admin-credentials.json";
  $credentials = json_decode((string) @file_get_contents($path), true);
  if (!is_array($credentials)
      || !filter_var((string) ($credentials["email"] ?? ""), FILTER_VALIDATE_EMAIL)
      || !password_verify(stream_get_contents(STDIN), (string) ($credentials["password_hash"] ?? ""))) {
      fwrite(STDERR, "Admin credentials could not be verified after setup.\n");
      exit(1);
  }
' "$CONFIG_FILE"

unset ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM
if [[ "$RESET_ADMIN" -eq 1 ]]; then
  echo "Admin login updated for $ADMIN_EMAIL. Existing store settings and data were preserved."
else
  echo "Installation settings saved."
  echo "Admin login: $ADMIN_EMAIL"
  echo "Store URL: $PUBLIC_BASE_URL"
  echo "Payment environment: $MODE"
  if [[ "$MODE" == "live" ]]; then
    echo "Warning: real transactions can occur once live provider credentials are configured."
  fi
  echo "Default sender: orders@${DOMAIN#www.} (verify the domain with Resend before sending mail)"
  echo "Private runtime data: $DATA_DIR_REAL"
  if [[ "${VPS_SETUP:-0}" -eq 1 ]]; then
    echo "Nginx and HTTPS are configured for $DOMAIN."
  else
    echo "Nginx/TLS were not changed; ensure your host serves this domain over HTTPS."
  fi
  echo "Next: finish provider settings in Admin → Configurations."
fi
echo "No plaintext password or API key was written to the terminal or config file."
