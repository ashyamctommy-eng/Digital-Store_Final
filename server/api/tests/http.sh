#!/usr/bin/env bash
# End-to-end HTTP tests for the payment API, run against PHP's built-in server
# with a router that emulates the .htaccess rewrites.
#
#   bash server/api/tests/http.sh
#
# Requires a PHP CLI binary. Set PHP_BIN=/path/to/php if it is not on PATH.

set -uo pipefail

PHP_BIN="${PHP_BIN:-php}"
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8903}"
BASE="http://127.0.0.1:${PORT}/api"

DATA_DIR="$(mktemp -d)"
CONFIG_FILE="$API_DIR/config.php"
CONFIG_BACKUP=""

PASS=0
FAIL=0
SERVER_PID=""

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }

check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "  $(green PASS)  $1"
    PASS=$((PASS + 1))
  else
    echo "  $(red FAIL)  $1"
    echo "        expected: $2"
    echo "        actual:   $3"
    FAIL=$((FAIL + 1))
  fi
}

check_contains() { # check_contains <label> <needle> <haystack>
  case "$3" in
    *"$2"*) echo "  $(green PASS)  $1"; PASS=$((PASS + 1)) ;;
    *) echo "  $(red FAIL)  $1"; echo "        missing: $2"; echo "        in:      ${3:0:300}"; FAIL=$((FAIL + 1)) ;;
  esac
}

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  if [ -n "$CONFIG_BACKUP" ]; then
    mv "$CONFIG_BACKUP" "$CONFIG_FILE"
  else
    rm -f "$CONFIG_FILE"
  fi
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

# ---------------------------------------------------------------- setup
# Preserve any real config.php the developer has locally.
if [ -f "$CONFIG_FILE" ]; then
  CONFIG_BACKUP="$(mktemp)"
  cp "$CONFIG_FILE" "$CONFIG_BACKUP"
fi

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
];
PHPEOF

"$PHP_BIN" -S "127.0.0.1:${PORT}" -t "$API_DIR" "$API_DIR/tests/router.php" >/tmp/dhs-http-server.log 2>&1 &
SERVER_PID=$!
sleep 1.2

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "server failed to start:"; cat /tmp/dhs-http-server.log; exit 1
fi

echo
echo -e "\033[1mRouting & config\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/config-status")
check "GET /api/config-status -> 200" "200" "$CODE"
check_contains "reports plaintext provider mode" '"mode":"sandbox"' "$(cat /tmp/dhs-r.json)"
check_contains "reports data dir writable" '"data_dir_writable":true' "$(cat /tmp/dhs-r.json)"
check_contains "never leaks a key value" 'false' "$(cat /tmp/dhs-r.json)"

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

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'Content-Type: application/json' -H 'x-admin-key: wrong' -d '{"productId":"p1","text":"a|b"}')
check "wrong admin key -> 401" "401" "$CODE"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin/inventory/list")
check "list without key -> 401" "401" "$CODE"

echo
echo -e "\033[1mBulk credential upload\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'Content-Type: application/json' -H 'x-admin-key: test-admin-key' \
  -d '{"productId":"vpn-nord-1y","text":"ACC1|p1|e1@x.com\nACC2|p2|e2@x.com\nACC3|p3"}')
check "bulk add -> 200" "200" "$CODE"
check_contains "added 3 units" '"added":3' "$(cat /tmp/dhs-r.json)"
check_contains "available is 3" '"available":3' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'Content-Type: application/json' -H 'x-admin-key: test-admin-key' \
  -d '{"productId":"vpn-nord-1y","text":"ACC1|p1|e1@x.com\nACC4|p4"}')
check_contains "re-upload dedupes" '"duplicates":1' "$(cat /tmp/dhs-r.json)"
check_contains "available is 4" '"available":4' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'Content-Type: application/json' -H 'x-admin-key: test-admin-key' \
  -d '{"productId":"vpn-nord-1y","text":"DRY1|only-preview","dryRun":true}')
check_contains "dry run parses without committing" '"dry_run":true' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'Content-Type: application/json' -H 'x-admin-key: test-admin-key' -d '{"productId":"p1","text":"  "}')
check "empty paste -> 422" "422" "$CODE"

echo
echo -e "\033[1mPublic stock counts\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/inventory/counts")
check "GET /api/inventory/counts -> 200" "200" "$CODE"
check_contains "count reflects available stock" '"vpn-nord-1y":4' "$(cat /tmp/dhs-r.json)"
if grep -q 'only-preview' /tmp/dhs-r.json; then
  echo "  $(red FAIL)  dry-run credential leaked into stock"; FAIL=$((FAIL + 1))
else
  echo "  $(green PASS)  dry-run credential was not committed"; PASS=$((PASS + 1))
fi

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/admin/inventory/list" -H 'x-admin-key: test-admin-key')
check "admin list -> 200" "200" "$CODE"
check_contains "list totals available" '"available":4' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mOrder + webhook + dispatch\033[0m"

ORDER_ID="ORDER_vpn-nord-1y_1800000000000"
ORDER_TOKEN="tok_test_1234567890abcdef"

SEED=$("$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "vpn-nord-1y" "$ORDER_ID" "$ORDER_TOKEN" 2 "buyer@example.test")
check_contains "seeded an order with 2 units" '"seeded_units":6' "$SEED"

# Build a properly signed NOWPayments IPN for that order.
IPN_JSON=$(cat <<JSON
{"payment_status":"finished","order_id":"$ORDER_ID","price_amount":34.5,"price_currency":"usd","pay_currency":"usdttrc20"}
JSON
)
SIG=$("$PHP_BIN" -r '
$body = $argv[1];
$data = json_decode($body, true);
$sort = function ($a) use (&$sort) { foreach ($a as $k => $v) { if (is_array($v)) { $a[$k] = $sort($v); } } ksort($a); return $a; };
echo hash_hmac("sha512", json_encode($sort($data), JSON_UNESCAPED_SLASHES), "ipn-secret-123");
' "$IPN_JSON")

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/nowpayments/webhook" \
  -H 'Content-Type: application/json' -H "x-nowpayments-sig: $SIG" -d "$IPN_JSON")
check "signed IPN -> 200" "200" "$CODE"
check_contains "webhook reports the order paid" '"status":"paid"' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/nowpayments/webhook" \
  -H 'Content-Type: application/json' -H 'x-nowpayments-sig: badsig' -d "$IPN_JSON")
check "forged IPN -> 403" "403" "$CODE"
check_contains "forged IPN is refused" '"errorCode":"INVALID_SIGNATURE"' "$(cat /tmp/dhs-r.json)"

sleep 0.5
echo "  (post-response dispatch runs after the 200; giving it a moment)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/inventory/counts")
check_contains "stock decremented by the purchase (6 -> 4)" '"vpn-nord-1y":4' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mCredentials retrieval\033[0m"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/orders/credentials?order_id=$ORDER_ID")
check "no token -> 403" "403" "$CODE"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/orders/credentials?order_id=$ORDER_ID&token=wrong")
check "wrong token -> 403" "403" "$CODE"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/orders/credentials?order_id=NOPE&token=$ORDER_TOKEN")
check "unknown order -> 404" "404" "$CODE"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/orders/credentials?order_id=$ORDER_ID&token=$ORDER_TOKEN")
check "correct token -> 200" "200" "$CODE"
check_contains "status is paid" '"status":"paid"' "$(cat /tmp/dhs-r.json)"
check_contains "credentials delivered" '"account_data"' "$(cat /tmp/dhs-r.json)"
CRED_COUNT=$(grep -o 'account_data' /tmp/dhs-r.json | wc -l | tr -d ' ')
check "exactly the purchased quantity is delivered" "2" "$CRED_COUNT"

echo
echo -e "\033[1mStatus endpoint\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/orders/status?order_id=$ORDER_ID")
check "GET status -> 200" "200" "$CODE"
check_contains "status is paid" '"status":"paid"' "$(cat /tmp/dhs-r.json)"
check_contains "reports delivery complete" '"delivered":true' "$(cat /tmp/dhs-r.json)"
check_contains "reports the delivered count" '"delivered_count":2' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mPalplus webhook (unsigned payloads)\033[0m"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/palplus/webhook" \
  -H 'Content-Type: application/json' \
  -d '{"event":"transaction.updated","event_type":"transaction.success","transaction":{"id":"tx_unknown","external_reference":"NOPE12345678"}}')
check "unmatched reference is acknowledged" "200" "$CODE"
check_contains "unmatched reference is ignored" 'unknown order' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/palplus/webhook" \
  -H 'Content-Type: application/json' -d '{"garbage":true}')
check "empty payload is acknowledged" "200" "$CODE"

echo
echo -e "\033[1mSummary\033[0m"
echo "  $PASS passed, $FAIL failed"
echo

exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
