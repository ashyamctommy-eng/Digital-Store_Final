#!/usr/bin/env bash
# Interactive, secret-safe bootstrap for a fresh Digital Hub Shop deployment.
set -euo pipefail
umask 077

RESET_ADMIN=0
case "${1:-}" in
  "")
    ;;
  --reset-admin)
    RESET_ADMIN=1
    ;;
  --help|-h)
    cat <<'HELP'
Usage:
  sudo bash installer.sh          Configure a fresh installation
  sudo bash installer.sh --reset-admin
                                  Replace only the admin email/password

The installer never accepts a password in command-line arguments and never
stores plaintext passwords. Provider API keys are added later in the admin
Configurations page.
HELP
    exit 0
    ;;
  *)
    echo "Unknown option: $1" >&2
    exit 2
    ;;
esac

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

if ! command -v php >/dev/null 2>&1; then
  echo "PHP CLI is required to securely hash the admin password." >&2
  exit 1
fi
if ! php -r 'exit(PHP_VERSION_ID >= 80200 ? 0 : 1);'; then
  echo "PHP 8.2 or newer is required." >&2
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

if [[ "$RESET_ADMIN" -eq 1 ]]; then
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
  ADMIN_EMAIL="$(prompt 'Administrator email')"
else
  ADMIN_EMAIL="$(prompt 'Administrator email')"
  PUBLIC_BASE_URL="$(prompt 'Public site URL (HTTPS)' 'https://your-domain.example')"
  MODE="$(prompt 'Environment (sandbox or live)' 'sandbox')"
  if [[ "$MODE" != "sandbox" && "$MODE" != "live" ]]; then
    echo "Environment must be sandbox or live." >&2
    exit 1
  fi

  if [[ "$EUID" -eq 0 ]]; then
    DEFAULT_DATA_DIR="/var/lib/digital-hub-shop"
  else
    DEFAULT_DATA_DIR="${HOME:-/tmp}/.local/share/digital-hub-shop"
  fi
  DATA_DIR="$(prompt 'Private data directory (outside the web root)' "$DEFAULT_DATA_DIR")"
  if [[ "$DATA_DIR" != /* ]]; then
    echo "The data directory must be an absolute path." >&2
    exit 1
  fi
  if [[ "$DATA_DIR" == "$SCRIPT_DIR" || "$DATA_DIR" == "$SCRIPT_DIR/"* ]]; then
    echo "The data directory must be outside the application and web root." >&2
    exit 1
  fi

  DEFAULT_PHP_USER="$(id -un)"
  for candidate in www-data nginx apache; do
    if getent passwd "$candidate" >/dev/null 2>&1; then
      DEFAULT_PHP_USER="$candidate"
      break
    fi
  done
  PHP_USER="$(prompt 'PHP-FPM system user' "$DEFAULT_PHP_USER")"
  if ! getent passwd "$PHP_USER" >/dev/null 2>&1; then
    echo "No system user named '$PHP_USER' was found." >&2
    exit 1
  fi
  PHP_GROUP="$(id -gn "$PHP_USER")"
  if [[ "$EUID" -ne 0 && "$PHP_USER" != "$(id -un)" ]]; then
    echo "Run this installer with sudo so it can assign private storage to PHP-FPM user '$PHP_USER'." >&2
    exit 1
  fi

  if ! php -r '
    $url = $argv[1];
    $parts = parse_url($url);
    $https = is_array($parts) && ($parts["scheme"] ?? "") === "https";
    $localHttp = is_array($parts)
      && ($parts["scheme"] ?? "") === "http"
      && in_array(strtolower((string) ($parts["host"] ?? "")), ["localhost", "127.0.0.1", "::1"], true);
    exit(($https || $localHttp) && !empty($parts["host"]) && empty($parts["user"]) && empty($parts["pass"]) ? 0 : 1);
  ' "$PUBLIC_BASE_URL"; then
    echo "Enter a valid HTTPS URL (HTTP is only allowed for localhost testing)." >&2
    exit 1
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
cleanup() {
  [[ -n "${CONFIG_TMP:-}" && -f "${CONFIG_TMP:-}" ]] && rm -f -- "$CONFIG_TMP"
  [[ -n "${CREDENTIALS_TMP:-}" && -f "${CREDENTIALS_TMP:-}" ]] && rm -f -- "$CREDENTIALS_TMP"
  unset ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM
}
trap cleanup EXIT

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
  echo "Private runtime data: $DATA_DIR_REAL"
  echo "Next: finish provider settings in Admin → Configurations."
fi
echo "No plaintext password or API key was written to the terminal or config file."
