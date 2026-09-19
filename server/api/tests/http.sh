#!/usr/bin/env bash
# End-to-end HTTP tests for the payment + fulfilment API.
#
#   bash server/api/tests/http.sh
#
# Starts three servers: the API under test (php -S with tests/router.php, which
# emulates the .htaccess rewrites), a stub of the smsotp.net provider, and a stub
# of the NextProxy list API — so the on-demand SMS and proxy fallbacks can be
# exercised without spending real money or depending on a third party.
#
# Set PHP_BIN=/path/to/php if it is not on PATH.

set -uo pipefail

PHP_BIN="${PHP_BIN:-php}"
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8903}"
STUB_PORT="${STUB_PORT:-8905}"
BASE="http://127.0.0.1:${PORT}/api"
STUB_BASE="http://127.0.0.1:${STUB_PORT}/api/v1"
NP_STUB_PORT="${NP_STUB_PORT:-8906}"
NP_STUB_BASE="http://127.0.0.1:${NP_STUB_PORT}"

DATA_DIR="$(mktemp -d)"
STUB_STATE="$(mktemp)"
NP_STUB_STATE="$(mktemp)"
CONFIG_FILE="$API_DIR/config.php"
CONFIG_BACKUP=""
SERVER_PID=""
STUB_PID=""
NP_STUB_PID=""

PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }

check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "  $(green PASS)  $1"; PASS=$((PASS + 1))
  else
    echo "  $(red FAIL)  $1"; echo "        expected: $2"; echo "        actual:   $3"; FAIL=$((FAIL + 1))
  fi
}

check_contains() { # check_contains <label> <needle> <haystack>
  case "$3" in
    *"$2"*) echo "  $(green PASS)  $1"; PASS=$((PASS + 1)) ;;
    *) echo "  $(red FAIL)  $1"; echo "        missing: $2"; echo "        in:      ${3:0:400}"; FAIL=$((FAIL + 1)) ;;
  esac
}

check_absent() { # check_absent <label> <needle> <haystack>
  case "$3" in
    *"$2"*) echo "  $(red FAIL)  $1"; echo "        unexpectedly present: $2"; FAIL=$((FAIL + 1)) ;;
    *) echo "  $(green PASS)  $1"; PASS=$((PASS + 1)) ;;
  esac
}

stub_get() { # stub_get <key> -> value from the stub state file
  "$PHP_BIN" -r '$s = json_decode((string) file_get_contents($argv[1]), true) ?: []; $d = ["balance"=>99.94,"rent_calls"=>0,"info_calls"=>0,"code_after_polls"=>1,"code"=>123456,"rent_fails"=>false,"next_phone"=>15551230000]; $s = array_merge($d, $s); echo $s[$argv[2]] === true ? "true" : ($s[$argv[2]] === false ? "false" : $s[$argv[2]]);' "$STUB_STATE" "$1"
}

np_stub_get() { # np_stub_get <key> -> value from the proxy stub state file
  "$PHP_BIN" -r '$s = json_decode((string) file_get_contents($argv[1]), true) ?: []; $d = ["call_count"=>0,"addresses_served"=>0,"mode"=>"ok"]; $s = array_merge($d, $s); echo is_bool($s[$argv[2]]) ? ($s[$argv[2]] ? "true" : "false") : $s[$argv[2]];' "$NP_STUB_STATE" "$1"
}

np_stub_set() { # np_stub_set <key> <value>
  "$PHP_BIN" -r '$s = is_file($argv[1]) ? (json_decode((string) file_get_contents($argv[1]), true) ?: []) : []; $v = $argv[3]; $s[$argv[2]] = is_numeric($v) ? $v + 0 : ($v === "true" ? true : ($v === "false" ? false : $v)); file_put_contents($argv[1], json_encode($s));' "$NP_STUB_STATE" "$1" "$2"
}

stub_set() { # stub_set <key> <value>
  "$PHP_BIN" -r '$s = is_file($argv[1]) ? (json_decode((string) file_get_contents($argv[1]), true) ?: []) : []; $v = $argv[3]; $s[$argv[2]] = is_numeric($v) ? $v + 0 : ($v === "true" ? true : ($v === "false" ? false : $v)); file_put_contents($argv[1], json_encode($s));' "$STUB_STATE" "$1" "$2"
}

# Signs a NOWPayments IPN body the way the provider does.
sign_ipn() { # sign_ipn <json>
  "$PHP_BIN" -r '
    $data = json_decode($argv[1], true);
    $sort = function ($a) use (&$sort) { foreach ($a as $k => $v) { if (is_array($v)) { $a[$k] = $sort($v); } } ksort($a); return $a; };
    echo hash_hmac("sha512", json_encode($sort($data), JSON_UNESCAPED_SLASHES), "ipn-secret-123");
  ' "$1"
}

fire_paid_ipn() { # fire_paid_ipn <orderId> -> marks the order paid through the real webhook
  local json sig
  json="{\"payment_status\":\"finished\",\"order_id\":\"$1\",\"price_amount\":4.5,\"price_currency\":\"usd\"}"
  sig="$(sign_ipn "$json")"
  curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/nowpayments/webhook" \
    -H 'Content-Type: application/json' -H "x-nowpayments-sig: $sig" -d "$json"
}

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null
  [ -n "$NP_STUB_PID" ] && kill "$NP_STUB_PID" 2>/dev/null
  if [ -n "$CONFIG_BACKUP" ]; then mv "$CONFIG_BACKUP" "$CONFIG_FILE"; else rm -f "$CONFIG_FILE"; fi
  rm -rf "$DATA_DIR" "$STUB_STATE"
}
trap cleanup EXIT

# ---------------------------------------------------------------- setup
if [ -f "$CONFIG_FILE" ]; then CONFIG_BACKUP="$(mktemp)"; cp "$CONFIG_FILE" "$CONFIG_BACKUP"; fi

cat > "$STUB_STATE" <<'JSON'
{"balance":99.94,"rent_calls":0,"info_calls":0,"code_after_polls":1,"code":123456,"rent_fails":false,"next_phone":15551230000}
JSON

cat > "$NP_STUB_STATE" <<'JSON'
{"pool":[],"pool_size":500,"call_count":0,"addresses_served":0,"mode":"ok","rate_limit":60,"rate_remaining":48,"tier":"Guest Community Tier (60 req/min)","mask_every":0,"send_credit_headers":true}
JSON

cat > "$CONFIG_FILE" <<PHPEOF
<?php
return [
    'mode' => 'sandbox',
    'data_dir' => '$DATA_DIR',
    'store_name' => 'Digital Hub Shop Test',
    'public_base_url' => 'https://example.test',
    'admin_api_key' => 'test-admin-key',
    'inventory_drives_stock' => true,
    'palplus' => ['api_key' => 'pk_test_fake', 'sandbox_base' => 'https://sandbox.palplus.invalid/v1'],
    'nowpayments' => ['api_key' => '', 'ipn_secret' => 'ipn-secret-123', 'api_base' => 'https://api.nowpayments.invalid/v1'],
    'resend' => ['api_key' => '', 'from' => 'Test <t@example.test>'],
    'smsotp' => ['api_key' => 'stub-key', 'api_base' => '$STUB_BASE', 'min_balance' => 0.01, 'balance_cache_seconds' => 0],
    'nextproxy' => [
        'api_key' => '',
        'api_base' => '$NP_STUB_BASE',
        'list_path' => '/api/proxies',
        'auth_style' => 'header',
        'enabled' => true,
        'status_cache_seconds' => 0,
        'health_path' => '/api/health',
        'health_cache_seconds' => 0,
        'timeout_seconds' => 5,
    ],
];
PHPEOF

SMSOTP_STUB_STATE="$STUB_STATE" "$PHP_BIN" -S "127.0.0.1:${STUB_PORT}" "$API_DIR/tests/smsotp-stub.php" >/tmp/dhs-stub.log 2>&1 &
STUB_PID=$!
NEXTPROXY_STUB_STATE="$NP_STUB_STATE" "$PHP_BIN" -S "127.0.0.1:${NP_STUB_PORT}" "$API_DIR/tests/nextproxy-stub.php" >/tmp/dhs-np-stub.log 2>&1 &
NP_STUB_PID=$!
"$PHP_BIN" -S "127.0.0.1:${PORT}" -t "$API_DIR" "$API_DIR/tests/router.php" >/tmp/dhs-http-server.log 2>&1 &
SERVER_PID=$!
sleep 1.5

if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo "server failed to start:"; cat /tmp/dhs-http-server.log; exit 1; fi
if ! kill -0 "$STUB_PID" 2>/dev/null; then echo "stub failed to start:"; cat /tmp/dhs-stub.log; exit 1; fi
if ! kill -0 "$NP_STUB_PID" 2>/dev/null; then echo "proxy stub failed to start:"; cat /tmp/dhs-np-stub.log; exit 1; fi

echo
echo -e "\033[1mRouting & config\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/config-status")
check "GET /api/config-status -> 200" "200" "$CODE"
check_contains "reports provider mode" '"mode":"sandbox"' "$(cat /tmp/dhs-r.json)"
check_contains "reports data dir writable" '"data_dir_writable":true' "$(cat /tmp/dhs-r.json)"
check_contains "reports the SMS provider configured" '"configured":true' "$(cat /tmp/dhs-r.json)"
check_absent "never leaks an API key" 'stub-key' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/nope/nothing")
check "unknown route -> 404" "404" "$CODE"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/config-status")
check "wrong method -> 405" "405" "$CODE"

echo
echo -e "\033[1mAdmin authentication\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'Content-Type: application/json' -d '{"productId":"p1","text":"a|b"}')
check "no admin key -> 401" "401" "$CODE"
check_contains "rejects with a code" '"errorCode":"UNAUTHORIZED"' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin/smsotp-status")
check "smsotp status without key -> 401" "401" "$CODE"

echo
echo -e "\033[1mOn-demand provider status\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/admin/smsotp-status" -H 'x-admin-key: test-admin-key')
check "GET /api/admin/smsotp-status -> 200" "200" "$CODE"
check_contains "reports the live balance" '"balance":99.94' "$(cat /tmp/dhs-r.json)"
check_contains "reports five SMS products" '"sms_products":5' "$(cat /tmp/dhs-r.json)"
check_contains "catalog service codes all exist" '"missing_service_ids":[]' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mBulk credential upload (non-SMS)\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'Content-Type: application/json' -H 'x-admin-key: test-admin-key' \
  -d '{"productId":"vpn-nord-1y","text":"ACC1|p1|e1@x.com\nACC2|p2|e2@x.com\nACC3|p3"}')
check "bulk add -> 200" "200" "$CODE"
check_contains "added 3 units" '"added":3' "$(cat /tmp/dhs-r.json)"
check_contains "parsed as credentials" '"kind":"credentials"' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'Content-Type: application/json' -H 'x-admin-key: test-admin-key' \
  -d '{"productId":"vpn-nord-1y","text":"ACC1|p1|e1@x.com\nACC4|p4"}')
check_contains "re-upload dedupes" '"duplicates":1' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mBulk SMS upload (PHONE | INBOX_URL_OR_NOTES)\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'Content-Type: application/json' -H 'x-admin-key: test-admin-key' \
  -d '{"productId":"sms-whatsapp","text":"+15551110001 | https://inbox.test/a\n+15551110002 | Watch this inbox\n+15551110003\n+15551110004 | javascript:alert(1)"}')
check "SMS bulk add -> 200" "200" "$CODE"
check_contains "detected as SMS from the catalog" '"kind":"sms"' "$(cat /tmp/dhs-r.json)"
check_contains "added 4 numbers" '"added":4' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'Content-Type: application/json' -H 'x-admin-key: test-admin-key' \
  -d '{"productId":"sms-whatsapp","text":"+15551110001 | https://inbox.test/a","dryRun":true}')
check_contains "dry run previews SMS lines" '"kind":"sms"' "$(cat /tmp/dhs-r.json)"
check_contains "preview exposes the inbox link" 'inbox.test/a' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mStatic stock is preferred over the provider\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/inventory/counts")
check_contains "counts include the SMS product" '"sms-whatsapp":4' "$(cat /tmp/dhs-r.json)"
check_absent "a well-stocked product is not offered on demand" '"sms-whatsapp"' "$(cat /tmp/dhs-r.json | sed 's/.*"dynamic"://')"

ORDER_ID="ORDER_sms-whatsapp_1800000000001"
TOKEN="tok_sms_abcdef123456"
# 0 stock units added (4 are already stocked) + an order for 1.
SEED=$("$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "sms-whatsapp" "$ORDER_ID" "$TOKEN" 0 1 "sms@example.test")
check_contains "order seeded without touching stock" '"stock_added":0' "$SEED"
check_contains "4 numbers remain in stock" '"available":4' "$SEED"

RENT_BEFORE=$(stub_get rent_calls)
CODE=$(fire_paid_ipn "$ORDER_ID")
check "signed IPN -> 200" "200" "$CODE"
sleep 0.6

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=$ORDER_ID&token=$TOKEN")
check "credentials -> 200" "200" "$CODE"
check_contains "delivered a phone number" '"phone_number":"+15551110001"' "$(cat /tmp/dhs-r.json)"
check_contains "delivered the inbox link" '"inbox_url":"https://inbox.test/a"' "$(cat /tmp/dhs-r.json)"
check_contains "marked as an SMS delivery" '"kind":"sms"' "$(cat /tmp/dhs-r.json)"
check_contains "came from static stock" '"source":"static"' "$(cat /tmp/dhs-r.json)"

RENT_AFTER=$(stub_get rent_calls)
check "the provider was not charged (rent calls ${RENT_BEFORE} -> ${RENT_AFTER})" "$RENT_BEFORE" "$RENT_AFTER"

echo
echo -e "\033[1mDynamic fallback when static stock runs out\033[0m"

# Drain the remaining 3 static numbers with orders that add no stock.
for i in 2 3 4; do
  O="ORDER_sms-whatsapp_18000000000${i}0"
  T="tok_drain_${i}"
  "$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "sms-whatsapp" "$O" "$T" 0 1 "drain${i}@example.test" >/dev/null
  fire_paid_ipn "$O" >/dev/null
done
sleep 1.0

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/inventory/counts")
check_contains "static stock is now empty" '"sms-whatsapp":0' "$(cat /tmp/dhs-r.json)"
check_contains "the product is offered on demand" '"sms-whatsapp"' "$(cat /tmp/dhs-r.json | sed 's/.*"dynamic"://')"

DYN_ORDER="ORDER_sms-whatsapp_1800000000099"
DYN_TOKEN="tok_dynamic_abcdef"
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "sms-whatsapp" "$DYN_ORDER" "$DYN_TOKEN" 0 1 "dyn@example.test" >/dev/null
RENT_BEFORE=$(stub_get rent_calls)
fire_paid_ipn "$DYN_ORDER" >/dev/null
sleep 0.8

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=$DYN_ORDER&token=$DYN_TOKEN")
check "dynamic order credentials -> 200" "200" "$CODE"
check_contains "came from the on-demand provider" '"source":"dynamic"' "$(cat /tmp/dhs-r.json)"
check_contains "carries a provider phone number" '"phone_number":"+15551230000"' "$(cat /tmp/dhs-r.json)"
check_contains "records the activation id" '"sms_phone_id":"90001"' "$(cat /tmp/dhs-r.json)"

RENT_AFTER=$(stub_get rent_calls)
check "the provider was charged exactly once (${RENT_BEFORE} -> ${RENT_AFTER})" "1" "$RENT_AFTER"

echo
echo -e "\033[1mLive inbox polling for on-demand numbers\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/sms-status?order_id=$DYN_ORDER&token=$DYN_TOKEN")
check "GET /api/orders/sms-status -> 200" "200" "$CODE"
check_contains "reports the number" '"phone_number":"+15551230000"' "$(cat /tmp/dhs-r.json)"
check_contains "first poll is still pending" '"pending":true' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/sms-status?order_id=$DYN_ORDER&token=$DYN_TOKEN")
check "second poll -> 200" "200" "$CODE"
check_contains "the code is now delivered" '"code":"123456"' "$(cat /tmp/dhs-r.json)"
check_contains "the raw message is delivered" 'Your verification code is 123456' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  "$BASE/orders/sms-status?order_id=$DYN_ORDER&token=wrong")
check "sms-status with a bad token -> 403" "403" "$CODE"

echo
echo -e "\033[1mOut of Stock when neither source can deliver\033[0m"

stub_set balance 0
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/inventory/counts")
check_absent "no SMS product is offered once the balance is empty" '"sms-' "$(cat /tmp/dhs-r.json | sed 's/.*"dynamic"://')"

EMPTY_ORDER="ORDER_sms-telegram_1800000000200"
EMPTY_TOKEN="tok_empty_abcdef"
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "sms-telegram" "$EMPTY_ORDER" "$EMPTY_TOKEN" 0 1 "empty@example.test" >/dev/null
RENT_BEFORE=$(stub_get rent_calls)
fire_paid_ipn "$EMPTY_ORDER" >/dev/null
sleep 0.6

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=$EMPTY_ORDER&token=$EMPTY_TOKEN")
check "credentials -> 200" "200" "$CODE"
check_contains "nothing is delivered" '"credentials":[]' "$(cat /tmp/dhs-r.json)"
check_contains "the shortfall is recorded" '"sms-telegram":1' "$(cat /tmp/dhs-r.json)"

RENT_AFTER=$(stub_get rent_calls)
check "no number was bought with an empty balance (${RENT_BEFORE} -> ${RENT_AFTER})" "$RENT_BEFORE" "$RENT_AFTER"

stub_set rent_fails true
stub_set balance 50
FAIL_ORDER="ORDER_sms-facebook_1800000000300"
FAIL_TOKEN="tok_fail_abcdef"
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "sms-facebook" "$FAIL_ORDER" "$FAIL_TOKEN" 0 1 "fail@example.test" >/dev/null
fire_paid_ipn "$FAIL_ORDER" >/dev/null
sleep 0.6
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=$FAIL_ORDER&token=$FAIL_TOKEN")
check_contains "a provider refusal becomes a shortfall, not a false delivery" '"sms-facebook":1' "$(cat /tmp/dhs-r.json)"
check_contains "and nothing is delivered" '"credentials":[]' "$(cat /tmp/dhs-r.json)"
stub_set rent_fails false

echo
echo -e "\033[1mCredentials retrieval (non-SMS regression)\033[0m"

VPN_ORDER="ORDER_vpn-nord-1y_1800000000400"
VPN_TOKEN="tok_vpn_abcdef"
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "vpn-nord-1y" "$VPN_ORDER" "$VPN_TOKEN" 2 2 "vpn@example.test" >/dev/null
fire_paid_ipn "$VPN_ORDER" >/dev/null
sleep 0.6

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/orders/credentials?order_id=$VPN_ORDER")
check "no token -> 403" "403" "$CODE"
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/orders/credentials?order_id=$VPN_ORDER&token=$VPN_TOKEN")
check "correct token -> 200" "200" "$CODE"
check_contains "credentials still work as before" '"account_data"' "$(cat /tmp/dhs-r.json)"
CRED_COUNT=$(grep -o 'account_data' /tmp/dhs-r.json | wc -l | tr -d ' ')
check "exactly the purchased quantity is delivered" "2" "$CRED_COUNT"

echo
echo -e "\033[1mPalplus webhook (unsigned payloads)\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/palplus/webhook" \
  -H 'Content-Type: application/json' \
  -d '{"event":"transaction.updated","event_type":"transaction.success","transaction":{"id":"tx_unknown","external_reference":"NOPE12345678"}}')
check "unmatched reference is acknowledged" "200" "$CODE"
check_contains "unmatched reference is ignored" 'unknown order' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mProxy provider status (admin)\033[0m"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin/nextproxy-status")
check "nextproxy status without key -> 401" "401" "$CODE"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/admin/nextproxy-status" -H 'x-admin-key: test-admin-key')
check "GET /api/admin/nextproxy-status -> 200" "200" "$CODE"
check_contains "reports the provider reachable" '"ok":true' "$(cat /tmp/dhs-r.json)"
check_contains "reports the account tier" '"tier":"Guest Community Tier (60 req/min)"' "$(cat /tmp/dhs-r.json)"
check_contains "reports the rate-limit window from headers" '"rate_limit":60' "$(cat /tmp/dhs-r.json)"
check_contains "labels where the quota number came from" '"rate_limit_source":"header"' "$(cat /tmp/dhs-r.json)"
check_contains "explains there is no credits endpoint" '"credits_source":null' "$(cat /tmp/dhs-r.json)"
check_contains "lists the proxy products it drives" '"product_id":"proxy-9p-10"' "$(cat /tmp/dhs-r.json)"
check_contains "reports 10 addresses per unit" '"per_unit":10' "$(cat /tmp/dhs-r.json)"
check_absent "never leaks the api key" 'nex_live' "$(cat /tmp/dhs-r.json)"

# config-status should describe the integration without exposing key material.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/config-status")
check "GET /api/config-status -> 200" "200" "$CODE"
check_contains "reports the proxy provider usable without a key" '"configured":true' "$(cat /tmp/dhs-r.json)"
check_contains "counts the proxy products" '"proxy_products":3' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mProxy API key management (admin)\033[0m"

# Make the provider reject any key it is given, so a rejection proves the
# stored value is genuinely being transmitted rather than merely saved.
np_stub_set mode invalid_key
TEST_KEY="nex_live_test_000000000000abcd"
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/nextproxy-key" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d "{\"apiKey\":\"$TEST_KEY\"}")
check "POST /api/admin/nextproxy-key -> 200" "200" "$CODE"
check_contains "reports the key as stored" '"key_source":"settings"' "$(cat /tmp/dhs-r.json)"
check_contains "masks the key when echoing it back" '"key_masked":"nex_••••••abcd"' "$(cat /tmp/dhs-r.json)"
check_absent "never echoes the full key back" "$TEST_KEY" "$(cat /tmp/dhs-r.json)"
check_contains "surfaces the provider's rejection" 'Invalid API key provided.' "$(cat /tmp/dhs-r.json)"
check "the stored key is what the provider received" "$TEST_KEY" "$(np_stub_get last_key)"
check "the key is sent as a header, not in the URL" "header" "$(np_stub_get last_auth)"
np_stub_set mode ok

if [ -f "$DATA_DIR/settings.json" ]; then
  check "the settings file is not world-readable" "600" "$(stat -c '%a' "$DATA_DIR/settings.json")"
else
  check "the settings file was written" "present" "missing"
fi

# A key with whitespace is refused before it reaches the provider.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/nextproxy-key" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' -d '{"apiKey":"bad key with space"}')
check "a key containing spaces is refused" "422" "$CODE"

# An unrelated setting cannot be written through this endpoint.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/nextproxy-key" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' -d '{"apiKey":"","admin_api_key":"pwned"}')
check "an unrelated key is not writable here" "200" "$CODE"
check_absent "admin_api_key was not overwritten" 'pwned' "$(cat "$DATA_DIR/settings.json" 2>/dev/null)"

# Clearing the key falls back to config rather than disabling anything.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/nextproxy-key" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' -d '{"apiKey":""}')
check "clearing the key -> 200" "200" "$CODE"
check_contains "falls back to no configured key" '"key_source":"none"' "$(cat /tmp/dhs-r.json)"
check_contains "still works without a key" '"ok":true' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mProxy delivery: pre-bought stock is preferred\033[0m"

# proxy-dc-03 is "25 IPs": 50 addresses of stock is 2 whole units.
SEED=$("$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "proxy-dc-03" "ORDER_proxy-dc-03_1800000000001" "tok_proxy_static" 50 1 "proxy@example.test")
check_contains "seeded 50 addresses" '"available":50' "$SEED"
check_contains "recognised as a proxy product" '"kind":"proxy"' "$SEED"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/inventory/counts")
check_contains "counts include the proxy product" '"proxy-dc-03":50' "$(cat /tmp/dhs-r.json)"
check_absent "a fully stocked product is not offered on demand" '"proxy-dc-03"' "$(cat /tmp/dhs-r.json | sed 's/.*"dynamic"://')"

SERVED_BEFORE=$(np_stub_get addresses_served)
CODE=$(fire_paid_ipn "ORDER_proxy-dc-03_1800000000001")
check "signed IPN for a proxy order -> 200" "200" "$CODE"
sleep 0.6

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=ORDER_proxy-dc-03_1800000000001&token=tok_proxy_static")
check "proxy credentials -> 200" "200" "$CODE"
check_contains "delivered as a proxy unit" '"kind":"proxy"' "$(cat /tmp/dhs-r.json)"
check_contains "came from pre-bought stock" '"source":"static"' "$(cat /tmp/dhs-r.json)"
check_contains "reports 25 addresses for the unit" '"proxy_count":25' "$(cat /tmp/dhs-r.json)"

ADDRESSES=$("$PHP_BIN" -r '$d = json_decode((string) file_get_contents($argv[1]), true); $u = $d["credentials"][0] ?? []; echo count($u["proxies"] ?? []);' /tmp/dhs-r.json)
check "one unit is exactly 25 addresses" "25" "$ADDRESSES"

FIRST_ADDRESS=$("$PHP_BIN" -r '$d = json_decode((string) file_get_contents($argv[1]), true); echo $d["credentials"][0]["proxies"][0] ?? "";' /tmp/dhs-r.json)
check "addresses are formatted IP:PORT" "203.0.9.1:9000" "$FIRST_ADDRESS"

SERVED_AFTER=$(np_stub_get addresses_served)
check "the provider was not charged for addresses (${SERVED_BEFORE} -> ${SERVED_AFTER})" "$SERVED_BEFORE" "$SERVED_AFTER"

echo
echo -e "\033[1mProxy delivery: a partial unit is never sold\033[0m"

# proxy-9p-10 is "10 IPs" and starts empty here. 7 addresses cannot make a
# whole unit, so the order must be supplied by the provider rather than
# shipping 7 addresses for the price of 10.
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "proxy-9p-10" "ORDER_proxy-9p-10_1800000000010" "tok_proxy_partial" 7 1 "partial@example.test" >/dev/null
fire_paid_ipn "ORDER_proxy-9p-10_1800000000010" >/dev/null
sleep 0.6

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=ORDER_proxy-9p-10_1800000000010&token=tok_proxy_partial")
check "partial-stock order credentials -> 200" "200" "$CODE"
check_contains "supplied by the provider instead" '"source":"dynamic"' "$(cat /tmp/dhs-r.json)"
PARTIAL_COUNT=$("$PHP_BIN" -r '$d = json_decode((string) file_get_contents($argv[1]), true); echo $d["credentials"][0]["proxy_count"] ?? 0;' /tmp/dhs-r.json)
check "still a full 10-address unit" "10" "$PARTIAL_COUNT"

# The 7 stranded addresses stay in stock for a future order.
check_contains "the stranded addresses are still in stock" '"proxy-9p-10":7' "$(curl -s "$BASE/inventory/counts")"

echo
echo -e "\033[1mProxy delivery: on demand when static stock is empty\033[0m"

SERVED_BEFORE=$(np_stub_get addresses_served)
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "proxy-mobile-02" "ORDER_proxy-mobile-02_1800000000020" "tok_proxy_dynamic" 0 1 "dynproxy@example.test" >/dev/null

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/inventory/counts")
check_contains "an unstocked proxy product is offered on demand" '"proxy-mobile-02"' "$(cat /tmp/dhs-r.json | sed 's/.*"dynamic"://')"

fire_paid_ipn "ORDER_proxy-mobile-02_1800000000020" >/dev/null
sleep 0.8

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=ORDER_proxy-mobile-02_1800000000020&token=tok_proxy_dynamic")
check "on-demand proxy credentials -> 200" "200" "$CODE"
check_contains "came from the provider" '"source":"dynamic"' "$(cat /tmp/dhs-r.json)"
check_contains "records the pool tier" '"pool_tier":"Guest Community Tier (60 req/min)"' "$(cat /tmp/dhs-r.json)"
check_contains "carries the socks5 protocol filter" '"proxy_protocol":"socks5"' "$(cat /tmp/dhs-r.json)"
DC_COUNT=$("$PHP_BIN" -r '$d = json_decode((string) file_get_contents($argv[1]), true); echo $d["credentials"][0]["proxy_count"] ?? 0;' /tmp/dhs-r.json)
check "delivered 5 addresses for a 5-IP product" "5" "$DC_COUNT"

SERVED_AFTER=$(np_stub_get addresses_served)
check "the provider supplied the addresses (${SERVED_BEFORE} -> ${SERVED_AFTER})" "yes" "$([ "$SERVED_AFTER" -gt "$SERVED_BEFORE" ] && echo yes || echo no)"

echo
echo -e "\033[1mProxy delivery: quantity multiplies the unit\033[0m"

# 2 units of a 10-IP product = 20 addresses. proxy-9p-10 holds 7 stranded
# addresses, which is still short of a unit, so the provider supplies both.
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "proxy-9p-10" "ORDER_proxy-9p-10_1800000000030" "tok_proxy_qty" 0 2 "qty@example.test" >/dev/null
fire_paid_ipn "ORDER_proxy-9p-10_1800000000030" >/dev/null
sleep 0.8

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=ORDER_proxy-9p-10_1800000000030&token=tok_proxy_qty")
check "quantity-2 proxy credentials -> 200" "200" "$CODE"
UNITS=$("$PHP_BIN" -r '$d = json_decode((string) file_get_contents($argv[1]), true); echo count($d["credentials"] ?? []);' /tmp/dhs-r.json)
check "an order for 2 units delivered 2 units" "2" "$UNITS"
QTY_ADDRESSES=$("$PHP_BIN" -r '$d = json_decode((string) file_get_contents($argv[1]), true); $n = 0; foreach ($d["credentials"] ?? [] as $u) { $n += count($u["proxies"] ?? []); } echo $n;' /tmp/dhs-r.json)
check "10 addresses per unit x 2 units = 20" "20" "$QTY_ADDRESSES"
DISTINCT=$("$PHP_BIN" -r '$d = json_decode((string) file_get_contents($argv[1]), true); $a = []; foreach ($d["credentials"] ?? [] as $u) { foreach ($u["proxies"] ?? [] as $x) { $a[$x] = 1; } } echo count($a);' /tmp/dhs-r.json)
check "no address was delivered twice" "20" "$DISTINCT"

echo
echo -e "\033[1mProxy delivery: Out of Stock when the provider cannot deliver\033[0m"

# proxy-mobile-02 is empty at this point, so only the provider could deliver.
np_stub_set mode outage
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "proxy-mobile-02" "ORDER_proxy-mobile-02_1800000000040" "tok_proxy_outage" 0 1 "outage@example.test" >/dev/null
fire_paid_ipn "ORDER_proxy-mobile-02_1800000000040" >/dev/null
sleep 0.8

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=ORDER_proxy-mobile-02_1800000000040&token=tok_proxy_outage")
check "outage order credentials -> 200" "200" "$CODE"
check_contains "delivered nothing" '"credentials":[]' "$(cat /tmp/dhs-r.json)"
check_contains "records the shortfall" '"proxy-mobile-02":1' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/inventory/counts")
check_absent "an unreachable provider is not offered on demand" '"proxy-mobile-02"' "$(cat /tmp/dhs-r.json | sed 's/.*"dynamic"://')"
# A proxy outage must not take SMS down with it.
check_contains "SMS availability is unaffected by a proxy outage" '"sms-telegram"' "$(cat /tmp/dhs-r.json | sed 's/.*"dynamic"://')"

np_stub_set mode ok

echo
echo -e "\033[1mProxy delivery: masked rows and pagination\033[0m"

# The live free tier masks a share of every page ("185.68.•••.•••"), so a full
# page yields FEWER usable addresses than were requested. Comparing the usable
# count against the page size stopped paging after one page and short-changed
# every multi-page order. This section is the regression guard for that.

# Drain proxy-dc-03 so the provider must supply the next order.
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "proxy-dc-03" "ORDER_proxy-dc-03_1800000000050" "tok_drain_dc" 0 1 "draindc@example.test" >/dev/null
fire_paid_ipn "ORDER_proxy-dc-03_1800000000050" >/dev/null
sleep 0.8
check_contains "proxy-dc-03 static stock is drained" '"proxy-dc-03":0' "$(curl -s "$BASE/inventory/counts")"

# Now mask every 4th row, as the free tier does.
np_stub_set mask_every 4
PAGES_BEFORE=$(np_stub_get pages_requested)

"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "proxy-dc-03" "ORDER_proxy-dc-03_1800000000060" "tok_masked" 0 1 "masked@example.test" >/dev/null
fire_paid_ipn "ORDER_proxy-dc-03_1800000000060" >/dev/null
sleep 1.2

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=ORDER_proxy-dc-03_1800000000060&token=tok_masked")
check "masked-page order credentials -> 200" "200" "$CODE"

MASKED_COUNT=$("$PHP_BIN" -r '
  $d = json_decode((string) file_get_contents($argv[1]), true);
  echo $d["credentials"][0]["proxy_count"] ?? 0;' /tmp/dhs-r.json)
check "a 25-IP order is still filled from masked pages" "25" "$MASKED_COUNT"

# Not one delivered address may carry the mask character.
MASK_LEAK=$("$PHP_BIN" -r '
  $d = json_decode((string) file_get_contents($argv[1]), true);
  $bad = 0;
  foreach ($d["credentials"] ?? [] as $u) {
    foreach ($u["proxies"] ?? [] as $p) {
      if (str_contains($p, "\u{2022}") || !preg_match("/^\d+\.\d+\.\d+\.\d+:\d+$/", $p)) $bad++;
    }
  }
  echo $bad;' /tmp/dhs-r.json)
check "no masked or malformed address was delivered" "0" "$MASK_LEAK"

# The mask character must not survive into the export either.
EXPORT_LINES=$("$PHP_BIN" -r '
  require $argv[2] . "/lib/http.php";
  require $argv[2] . "/lib/store.php";
  require $argv[2] . "/lib/dispatch.php";
  $o = ["order_id" => "ORDER_proxy-dc-03_1800000000060", "items" => []];
  $d = json_decode((string) file_get_contents($argv[1]), true);
  $t = dispatch_render_text($o, $d["credentials"] ?? []);
  echo str_contains($t, "\u{2022}") ? "leaked" : "clean";' /tmp/dhs-r.json "$API_DIR")
check "the .txt export contains no masked address" "clean" "$EXPORT_LINES"

# More than one page must have been requested, or the mask would have won.
PAGES_AFTER=$(np_stub_get pages_requested)
check "paging continued past the masked rows (${PAGES_BEFORE} -> ${PAGES_AFTER})" \
  "yes" "$([ "$PAGES_AFTER" -gt "$((PAGES_BEFORE + 1))" ] && echo yes || echo no)"

np_stub_set mask_every 0

echo
echo -e "\033[1mThe storefront availability check is free\033[0m"

# A credit is charged per request that returns addresses, so the page-load check
# must use the free /api/health endpoint. Spending a credit per page view would
# drain a 1,000-credit key in days.
CALLS_BEFORE=$(np_stub_get call_count)
HEALTH_BEFORE=$(np_stub_get health_calls)
for _ in 1 2 3 4 5; do curl -s -o /dev/null "$BASE/inventory/counts"; done
CALLS_AFTER=$(np_stub_get call_count)
HEALTH_AFTER=$(np_stub_get health_calls)

check "five storefront stock checks cost no proxy credits (${CALLS_BEFORE} -> ${CALLS_AFTER})" \
  "$CALLS_BEFORE" "$CALLS_AFTER"
check "they used the free health endpoint instead (${HEALTH_BEFORE} -> ${HEALTH_AFTER})" \
  "yes" "$([ "$HEALTH_AFTER" -gt "$HEALTH_BEFORE" ] && echo yes || echo no)"

echo -e "\033[1mProxy stock upload (admin)\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d '{"productId":"proxy-9p-10","text":"203.0.20.1:8080\n203.0.20.2:8080\n10.0.0.1:8080\nnot-an-address\n"}')
check "POST /api/admin/inventory/add (proxy) -> 200" "200" "$CODE"
check_contains "detects the proxy stock format" '"kind":"proxy"' "$(cat /tmp/dhs-r.json)"
check_contains "stored the two valid addresses" '"added":2' "$(cat /tmp/dhs-r.json)"
check_contains "rejects the private address" '10.0.0.1:8080' "$(cat /tmp/dhs-r.json)"
check_contains "rejects the malformed line" 'not-an-address' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mSummary\033[0m"
echo "  $PASS passed, $FAIL failed"
echo

exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
