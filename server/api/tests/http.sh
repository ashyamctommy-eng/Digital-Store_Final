#!/usr/bin/env bash
# End-to-end HTTP tests for the payment + fulfilment API.
#
#   bash server/api/tests/http.sh
#
# Starts two servers: the API under test (php -S with tests/router.php, which
# emulates the .htaccess rewrites) and a stub of the smsotp.net provider, so the
# on-demand SMS fallback can be exercised without spending real balance.
#
# Set PHP_BIN=/path/to/php if it is not on PATH.

set -uo pipefail

PHP_BIN="${PHP_BIN:-php}"
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8903}"
STUB_PORT="${STUB_PORT:-8905}"
BASE="http://127.0.0.1:${PORT}/api"
STUB_BASE="http://127.0.0.1:${STUB_PORT}/api/v1"

DATA_DIR="$(mktemp -d)"
STUB_STATE="$(mktemp)"
CONFIG_FILE="$API_DIR/config.php"
CONFIG_BACKUP=""
SERVER_PID=""
STUB_PID=""

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
  if [ -n "$CONFIG_BACKUP" ]; then mv "$CONFIG_BACKUP" "$CONFIG_FILE"; else rm -f "$CONFIG_FILE"; fi
  rm -rf "$DATA_DIR" "$STUB_STATE"
}
trap cleanup EXIT

# ---------------------------------------------------------------- setup
if [ -f "$CONFIG_FILE" ]; then CONFIG_BACKUP="$(mktemp)"; cp "$CONFIG_FILE" "$CONFIG_BACKUP"; fi

cat > "$STUB_STATE" <<'JSON'
{"balance":99.94,"rent_calls":0,"info_calls":0,"code_after_polls":1,"code":123456,"rent_fails":false,"next_phone":15551230000}
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
];
PHPEOF

SMSOTP_STUB_STATE="$STUB_STATE" "$PHP_BIN" -S "127.0.0.1:${STUB_PORT}" "$API_DIR/tests/smsotp-stub.php" >/tmp/dhs-stub.log 2>&1 &
STUB_PID=$!
"$PHP_BIN" -S "127.0.0.1:${PORT}" -t "$API_DIR" "$API_DIR/tests/router.php" >/tmp/dhs-http-server.log 2>&1 &
SERVER_PID=$!
sleep 1.5

if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo "server failed to start:"; cat /tmp/dhs-http-server.log; exit 1; fi
if ! kill -0 "$STUB_PID" 2>/dev/null; then echo "stub failed to start:"; cat /tmp/dhs-stub.log; exit 1; fi

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
check_contains "no dynamic offer with an empty balance" '"dynamic":[]' "$(cat /tmp/dhs-r.json)"

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
echo -e "\033[1mSummary\033[0m"
echo "  $PASS passed, $FAIL failed"
echo

exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
