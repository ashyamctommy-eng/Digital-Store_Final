#!/usr/bin/env bash
# End-to-end HTTP tests for the payment + fulfilment API.
#
#   bash server/api/tests/http.sh
#
# Starts the API under test (php -S with tests/router.php, which emulates the
# .htaccess rewrites), a stub of the smsotp.net provider so the on-demand SMS
# fallback can be exercised without spending real balance, and three real
# forwarding proxies plus a reflector stub so the proxy checker is tested
# against live traffic rather than a mocked result.
#
# Set PHP_BIN=/path/to/php if it is not on PATH.

set -uo pipefail

PHP_BIN="${PHP_BIN:-php}"
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8903}"
STUB_PORT="${STUB_PORT:-8905}"
ECHO_STUB_PORT="${ECHO_STUB_PORT:-8907}"
PX_ELITE_PORT="${PX_ELITE_PORT:-8908}"
PX_ANON_PORT="${PX_ANON_PORT:-8909}"
PX_TRANSPORT_PORT="${PX_TRANSPORT_PORT:-8910}"
BASE="http://127.0.0.1:${PORT}/api"
STUB_BASE="http://127.0.0.1:${STUB_PORT}/api/v1"

DATA_DIR="$(mktemp -d)"
STUB_STATE="$(mktemp)"
CONFIG_FILE="$API_DIR/config.php"
CONFIG_BACKUP=""
SERVER_PID=""
STUB_PID=""
STUB_PIDS=""

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

# The amount the provider reports for an order: derived from the catalog the
# same way the invoice was raised. A hardcoded figure here would let a fixture
# pass even when the webhook's amount check is broken — which is precisely how
# the missing check went unnoticed.
catalog_price_of() { # catalog_price_of <orderId>
  "$PHP_BIN" -r '
    require $argv[1] . "/lib/http.php";
    require $argv[1] . "/lib/store.php";
    require $argv[1] . "/lib/dispatch.php";
    require $argv[1] . "/lib/pricing.php";
    $config = load_config();
    $order = store_read_order($config, $argv[2]);
    $usd = $order === null
      ? null
      : pricing_total_usd(dispatch_normalise_items($order["items"] ?? []));
    echo $usd === null ? "0" : rtrim(rtrim(number_format($usd, 2, ".", ""), "0"), ".");
  ' "$API_DIR" "$1" 2>/dev/null || echo 0
}

fire_ipn_with_amount() { # fire_ipn_with_amount <orderId> <priceAmount>
  local json sig
  json="{\"payment_status\":\"finished\",\"order_id\":\"$1\",\"price_amount\":$2,\"price_currency\":\"usd\"}"
  sig="$(sign_ipn "$json")"
  curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/nowpayments/webhook" \
    -H 'Content-Type: application/json' -H "x-nowpayments-sig: $sig" -d "$json"
}

fire_paid_ipn() { # fire_paid_ipn <orderId> -> marks the order paid through the real webhook
  local json sig amount
  amount="$(catalog_price_of "$1")"
  json="{\"payment_status\":\"finished\",\"order_id\":\"$1\",\"price_amount\":${amount:-0},\"price_currency\":\"usd\"}"
  sig="$(sign_ipn "$json")"
  curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/nowpayments/webhook" \
    -H 'Content-Type: application/json' -H "x-nowpayments-sig: $sig" -d "$json"
}

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null
  for pid in $STUB_PIDS; do kill "$pid" 2>/dev/null; done
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
    // A fake key so the pricing checks are reachable: the `configured` gate runs
    // before them by design, so an unconfigured gateway would mask the result.
    'nowpayments' => ['api_key' => 'np_test_fake', 'ipn_secret' => 'ipn-secret-123', 'api_base' => 'https://api.nowpayments.invalid/v1'],
    'resend' => ['api_key' => '', 'from' => 'Test <t@example.test>'],
    'proxycheck' => [
        // The reflector and the proxies are all on localhost here, so private
        // addresses must be allowed for the CHECKER.
        'echo_url' => 'http://127.0.0.1:${ECHO_STUB_PORT}/echo',
        'timeout_seconds' => 6,
        'concurrency' => 5,
        'max_admin' => 20,
        'max_buyer' => 20,
        'allow_private' => true,
    ],
    'smsotp' => ['api_key' => 'stub-key', 'api_base' => '$STUB_BASE', 'min_balance' => 0.01, 'balance_cache_seconds' => 0],
];
PHPEOF

SMSOTP_STUB_STATE="$STUB_STATE" "$PHP_BIN" -S "127.0.0.1:${STUB_PORT}" "$API_DIR/tests/smsotp-stub.php" >/tmp/dhs-stub.log 2>&1 &
STUB_PID=$!
"$PHP_BIN" -S "127.0.0.1:${PORT}" -t "$API_DIR" "$API_DIR/tests/router.php" >/tmp/dhs-http-server.log 2>&1 &
SERVER_PID=$!

# The reflector the checker measures anonymity against, and three forwarding
# proxies that present themselves differently: elite adds nothing, anonymous adds
# a Via header, transparent forwards our own origin address.
"$PHP_BIN" -S "127.0.0.1:${ECHO_STUB_PORT}" "$API_DIR/tests/echo-stub.php" >/tmp/dhs-echo-stub.log 2>&1 &
STUB_PIDS="$!"
PROXY_STUB_MODE=elite "$PHP_BIN" "$API_DIR/tests/proxy-stub.php" "127.0.0.1:${PX_ELITE_PORT}" >/tmp/dhs-px-elite.log 2>&1 &
STUB_PIDS="$STUB_PIDS $!"
PROXY_STUB_MODE=anonymous "$PHP_BIN" "$API_DIR/tests/proxy-stub.php" "127.0.0.1:${PX_ANON_PORT}" >/tmp/dhs-px-anon.log 2>&1 &
STUB_PIDS="$STUB_PIDS $!"
PROXY_STUB_MODE=transparent "$PHP_BIN" "$API_DIR/tests/proxy-stub.php" "127.0.0.1:${PX_TRANSPORT_PORT}" >/tmp/dhs-px-transparent.log 2>&1 &
STUB_PIDS="$STUB_PIDS $!"
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
echo -e "\033[1mProxy delivery: addresses come from uploaded stock\033[0m"

# proxy-dc-03 is a "25 IPs" product: 50 addresses is 2 whole units.
SEED=$("$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "proxy-dc-03" "ORDER_proxy-dc-03_1800000000001" "tok_proxy_static" 50 1 "proxy@example.test")
check_contains "seeded 50 addresses" '"available":50' "$SEED"
check_contains "recognised as a proxy product" '"kind":"proxy"' "$SEED"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/inventory/counts")
check_contains "counts include the proxy product" '"proxy-dc-03":50' "$(cat /tmp/dhs-r.json)"
check_absent "proxy products are never offered on demand" '"proxy-' "$(cat /tmp/dhs-r.json | sed 's/.*"dynamic"://')"

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
check_contains "the remaining unit is still in stock" '"proxy-dc-03":25' "$(curl -s "$BASE/inventory/counts")"

echo
echo -e "\033[1mProxy delivery: a partial unit is never sold\033[0m"

# proxy-9p-10 is "10 IPs". Seven addresses cannot make a whole unit, so the order
# must deliver nothing rather than shipping 7 addresses for the price of 10.
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "proxy-9p-10" "ORDER_proxy-9p-10_1800000000010" "tok_proxy_partial" 7 1 "partial@example.test" >/dev/null
fire_paid_ipn "ORDER_proxy-9p-10_1800000000010" >/dev/null
sleep 0.6

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=ORDER_proxy-9p-10_1800000000010&token=tok_proxy_partial")
check "partial-stock order credentials -> 200" "200" "$CODE"
check_contains "delivered nothing" '"credentials":[]' "$(cat /tmp/dhs-r.json)"
check_contains "recorded a shortfall" '"proxy-9p-10":1' "$(cat /tmp/dhs-r.json)"
check_contains "the stranded addresses stay in stock" '"proxy-9p-10":7' "$(curl -s "$BASE/inventory/counts")"

echo
echo -e "\033[1mProxy delivery: an empty queue is Out of Stock\033[0m"

"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "proxy-mobile-02" "ORDER_proxy-mobile-02_1800000000020" "tok_proxy_empty" 0 1 "empty@example.test" >/dev/null
fire_paid_ipn "ORDER_proxy-mobile-02_1800000000020" >/dev/null
sleep 0.6

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=ORDER_proxy-mobile-02_1800000000020&token=tok_proxy_empty")
check "empty-queue order credentials -> 200" "200" "$CODE"
check_contains "delivered nothing" '"credentials":[]' "$(cat /tmp/dhs-r.json)"
check_contains "recorded the shortfall" '"proxy-mobile-02":1' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mProxy delivery: quantity multiplies the unit\033[0m"

# 2 units of a 10-IP product = 20 addresses, all distinct.
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "proxy-9p-10" "ORDER_proxy-9p-10_1800000000030" "tok_proxy_qty" 20 2 "qty@example.test" >/dev/null
fire_paid_ipn "ORDER_proxy-9p-10_1800000000030" >/dev/null
sleep 0.8

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' \
  "$BASE/orders/credentials?order_id=ORDER_proxy-9p-10_1800000000030&token=tok_proxy_qty")
check "quantity-2 proxy credentials -> 200" "200" "$CODE"
UNITS=$("$PHP_BIN" -r '$d = json_decode((string) file_get_contents($argv[1]), true); $n = 0; foreach ($d["credentials"] ?? [] as $u) { if (($u["kind"] ?? "") === "proxy") $n++; } echo $n;' /tmp/dhs-r.json)
check "an order for 2 units delivered 2 units" "2" "$UNITS"
QTY_ADDRESSES=$("$PHP_BIN" -r '$d = json_decode((string) file_get_contents($argv[1]), true); $n = 0; foreach ($d["credentials"] ?? [] as $u) { $n += count($u["proxies"] ?? []); } echo $n;' /tmp/dhs-r.json)
check "10 addresses per unit x 2 units = 20" "20" "$QTY_ADDRESSES"
DISTINCT=$("$PHP_BIN" -r '$d = json_decode((string) file_get_contents($argv[1]), true); $a = []; foreach ($d["credentials"] ?? [] as $u) { foreach ($u["proxies"] ?? [] as $x) { $a[$x] = 1; } } echo count($a);' /tmp/dhs-r.json)
check "no address was delivered twice" "20" "$DISTINCT"

echo -e "\033[1mProxy stock upload (admin)\033[0m"

# All four accepted formats, plus two lines that must be refused.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d '{"productId":"proxy-dc-03","text":"203.0.20.1:8080\nuser1:pass1@203.0.20.2:8080\n203.0.20.3:8080:user3:pass3\n203.0.20.4:8080 | user4:pass4\n10.0.0.1:8080\nnot-an-address\n"}')
check "POST /api/admin/inventory/add (proxy) -> 200" "200" "$CODE"
check_contains "detects the proxy stock format" '"kind":"proxy"' "$(cat /tmp/dhs-r.json)"
check_contains "stored all four accepted formats" '"added":4' "$(cat /tmp/dhs-r.json)"
check_contains "rejected the private address" '10.0.0.1:8080' "$(cat /tmp/dhs-r.json)"
check_contains "rejected the malformed line" 'not-an-address' "$(cat /tmp/dhs-r.json)"

# The credentials must survive the upload, not just the address.
LISTED=$("$PHP_BIN" -r '
  require $argv[1] . "/lib/http.php";
  require $argv[1] . "/lib/store.php";
  require $argv[1] . "/lib/inventory.php";
  $config = ["data_dir" => $argv[2]];
  $items = inventory_read($config, "proxy-dc-03")["items"] ?? [];
  $out = [];
  foreach (array_slice($items, -4) as $u) {
      $out[] = $u["uid"] . "|" . ($u["username"] ?? "") . ":" . ($u["password"] ?? "");
  }
  echo implode(" ", $out);' "$API_DIR" "$DATA_DIR")
check "credentials-first format kept its user/pass" "yes" "$(case "$LISTED" in *"203.0.20.2:8080|user1:pass1"*) echo yes;; *) echo "no ($LISTED)";; esac)"
check "credentials-last format kept its user/pass" "yes" "$(case "$LISTED" in *"203.0.20.3:8080|user3:pass3"*) echo yes;; *) echo "no ($LISTED)";; esac)"
check "pipe format kept its user/pass" "yes" "$(case "$LISTED" in *"203.0.20.4:8080|user4:pass4"*) echo yes;; *) echo "no ($LISTED)";; esac)"
check "a bare host:port has no credentials" "yes" "$(case "$LISTED" in *"203.0.20.1:8080|:"*) echo yes;; *) echo "no ($LISTED)";; esac)"

echo
echo
echo -e "\033[1mProxy checker (admin)\033[0m"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/admin/proxies/check" \
  -H 'Content-Type: application/json' -d '{"text":"127.0.0.1:1"}')
check "proxy check without an admin key -> 401" "401" "$CODE"

# Four formats plus one address that cannot possibly work.
CHECK_TEXT="u1:p1@127.0.0.1:${PX_ELITE_PORT}\n127.0.0.1:${PX_ANON_PORT}:u2:p2\n127.0.0.1:${PX_TRANSPORT_PORT}\n127.0.0.1:8999"
CHECK_BODY=$("$PHP_BIN" -r 'echo json_encode(["text" => $argv[1]]);' "$(printf "$CHECK_TEXT")")

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/proxies/check" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' -d "$CHECK_BODY")
check "POST /api/admin/proxies/check -> 200" "200" "$CODE"
check_contains "checked all four addresses" '"checked":4' "$(cat /tmp/dhs-r.json)"
check_contains "three of them work" '"healthy":3' "$(cat /tmp/dhs-r.json)"
check_contains "and one is dead" '"dead":1' "$(cat /tmp/dhs-r.json)"
check_contains "the dead one is scored zero" '"score":0' "$(cat /tmp/dhs-r.json)"
check_contains "speed is not claimed for a dead address" '"speed":"unreachable"' "$(cat /tmp/dhs-r.json)"
check_contains "the protocol is detected, not assumed" '"protocol":"http"' "$(cat /tmp/dhs-r.json)"
check_contains "an elite proxy is recognised" '"anonymity":"elite"' "$(cat /tmp/dhs-r.json)"
check_contains "an anonymous proxy is recognised" '"anonymity":"anonymous"' "$(cat /tmp/dhs-r.json)"
check_contains "a leaking proxy is recognised" '"anonymity":"transparent"' "$(cat /tmp/dhs-r.json)"
check_contains "credentials are carried through" '"username":"u1"' "$(cat /tmp/dhs-r.json)"
check_contains "the other credential format too" '"username":"u2"' "$(cat /tmp/dhs-r.json)"

# Ranking: best score first, dead last.
RANKED=$("$PHP_BIN" -r '
  $d = json_decode((string) file_get_contents($argv[1]), true);
  $s = array_map(static fn ($r) => (int) $r["score"], $d["results"] ?? []);
  $sorted = $s; rsort($sorted);
  echo ($s === $sorted) ? "ranked" : "unordered";' /tmp/dhs-r.json)
check "results come back ranked best-first" "ranked" "$RANKED"

ORDERED_ADDRESSES=$("$PHP_BIN" -r '
  $d = json_decode((string) file_get_contents($argv[1]), true);
  echo implode(",", array_column($d["results"] ?? [], "anonymity"));' /tmp/dhs-r.json)
check "the leaking proxy ranks below the anonymous one" "elite,anonymous,transparent,unknown" "$ORDERED_ADDRESSES"

# A leaking proxy must be visibly worse than one that does not leak.
LEAK_GAP=$("$PHP_BIN" -r '
  $d = json_decode((string) file_get_contents($argv[1]), true);
  $by = [];
  foreach ($d["results"] as $r) { $by[$r["anonymity"]] = (int) $r["score"]; }
  echo (($by["elite"] ?? 0) - ($by["transparent"] ?? 0)) >= 20 ? "yes" : "no";' /tmp/dhs-r.json)
check "elite scores well clear of transparent" "yes" "$LEAK_GAP"

# Checking a pasted list must not store anything: it is a read-only test.
BEFORE_COUNT=$(curl -s "$BASE/inventory/counts" | "$PHP_BIN" -r '$d = json_decode((string) stream_get_contents(STDIN), true); echo $d["counts"]["proxy-mobile-02"] ?? 0;')
curl -s -o /dev/null -X POST "$BASE/admin/proxies/check"   -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json'   -d "$CHECK_BODY"
AFTER_COUNT=$(curl -s "$BASE/inventory/counts" | "$PHP_BIN" -r '$d = json_decode((string) stream_get_contents(STDIN), true); echo $d["counts"]["proxy-mobile-02"] ?? 0;')
check "checking a list stores nothing (${BEFORE_COUNT} -> ${AFTER_COUNT})" "$BEFORE_COUNT" "$AFTER_COUNT"

echo
echo -e "\033[1mProxy checker (buyer, token-gated)\033[0m"

# An order carrying two live proxies and one dead one.
LIVE_ORDER="ORDER_proxy-dc-03_check1"
"$PHP_BIN" -r '
  require $argv[1] . "/lib/http.php";
  require $argv[1] . "/lib/store.php";
  $config = ["data_dir" => $argv[2]];
  store_write_order($config, [
    "order_id" => $argv[3], "order_token" => "tok_check", "status" => "paid",
    "currency" => "USD", "amount_usd" => 17, "buyer_email" => "buyer@example.test",
    "items" => [["product_id" => "proxy-dc-03", "name" => "Datacenter Proxies", "quantity" => 1]],
    "deliverables" => [[
      "kind" => "proxy", "source" => "static", "product_id" => "proxy-dc-03",
      "product_name" => "Datacenter Proxies",
      "proxies" => ["127.0.0.1:'"${PX_ELITE_PORT}"'", "127.0.0.1:'"${PX_ANON_PORT}"'", "127.0.0.1:8999"],
      "proxy_auth" => ["127.0.0.1:'"${PX_ELITE_PORT}"'" => "u1:p1"],
      "proxy_count" => 3,
    ]],
    "dispatched_at" => gmdate("c"),
  ]);' "$API_DIR" "$DATA_DIR" "$LIVE_ORDER"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/orders/proxies-check" \
  -H 'Content-Type: application/json' -d "{\"order_id\":\"$LIVE_ORDER\",\"token\":\"tok_check\"}")
check "POST /api/orders/proxies-check -> 200" "200" "$CODE"
check_contains "the buyer is told how many work" '"healthy":2' "$(cat /tmp/dhs-r.json)"
check_contains "and how many do not" '"dead":1' "$(cat /tmp/dhs-r.json)"

TICKS=$("$PHP_BIN" -r '
  $d = json_decode((string) file_get_contents($argv[1]), true);
  $ok = 0; foreach ($d["results"] ?? [] as $r) { if ($r["healthy"]) $ok++; }
  echo $ok;' /tmp/dhs-r.json)
check "two addresses would show a tick" "2" "$TICKS"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/orders/proxies-check" \
  -H 'Content-Type: application/json' -d "{\"order_id\":\"$LIVE_ORDER\",\"token\":\"wrong\"}")
check "a wrong token is refused" "403" "$CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/orders/proxies-check" \
  -H 'Content-Type: application/json' -d '{"order_id":"ORDER_does_not_exist","token":"x"}')
check "an unknown order is refused" "404" "$CODE"

# An order with no proxies must not become a way to test arbitrary addresses.
"$PHP_BIN" "$API_DIR/tests/seed.php" "$DATA_DIR" "vpn-nord-1y" "ORDER_plain_check" "tok_plain" 1 1 "p@example.test" >/dev/null
fire_paid_ipn "ORDER_plain_check" >/dev/null
sleep 0.6
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/orders/proxies-check" \
  -H 'Content-Type: application/json' -d '{"order_id":"ORDER_plain_check","token":"tok_plain"}')
check "a non-proxy order returns 200 with nothing to test" "200" "$CODE"
check_contains "and says so" 'no proxy addresses' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mChecking must not weaken what can be sold\033[0m"

# allow_private widens the CHECKER only. A loopback address is still refused at
# upload, because an unroutable address sold to a buyer is a support ticket.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/inventory/add" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d '{"productId":"proxy-mobile-02","text":"127.0.0.1:8080\n"}')
check "POST /api/admin/inventory/add -> 200" "200" "$CODE"
check_contains "a loopback address is still refused for stock" '127.0.0.1:8080' "$(cat /tmp/dhs-r.json)"
check_contains "and nothing was added" '"added":0' "$(cat /tmp/dhs-r.json)"

echo
echo
echo -e "\033[1mSuper-admin configurations\033[0m"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin/settings")
check "GET /api/admin/settings without a key -> 401" "401" "$CODE"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/admin/settings" -H 'x-admin-key: test-admin-key')
check "GET /api/admin/settings -> 200" "200" "$CODE"
check_contains "returns grouped fields" '"id":"general"' "$(cat /tmp/dhs-r.json)"
check_contains "includes the palplus group" '"id":"palplus"' "$(cat /tmp/dhs-r.json)"
check_contains "includes a setup checklist" '"ready_for_payments"' "$(cat /tmp/dhs-r.json)"
check_absent "never returns an API key value" 'pk_test_fake' "$(cat /tmp/dhs-r.json)"
check_contains "says what is not editable here" '"admin_api_key"' "$(cat /tmp/dhs-r.json)"

# A value saved from the console must be what the rest of the backend reads.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/settings" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d '{"settings":{"max_kes_amount":12345}}')
check "POST /api/admin/settings -> 200" "200" "$CODE"
check_contains "reports what it saved" '"max_kes_amount"' "$(cat /tmp/dhs-r.json)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' "$BASE/admin/settings" -H 'x-admin-key: test-admin-key')
check_contains "the saved value comes back" '"value":"12345"' "$(cat /tmp/dhs-r.json)"
check_contains "and is attributed to the console" '"source":"console"' "$(cat /tmp/dhs-r.json)"

# The point of the panel: a value set here must take effect across the running
# app without anyone editing files on the server. public_base_url is reported by
# config-status, so it proves the whole chain rather than just the write.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/settings" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d '{"settings":{"public_base_url":"https://from-console.test"}}')
check "saving a setting from the console -> 200" "200" "$CODE"
check_contains "the running config picked it up immediately" \
  '"public_base_url":"https://from-console.test"' "$(curl -s "$BASE/config-status")"

# Clearing it falls back to config.php, which is how a value is removed.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/settings" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d '{"settings":{"public_base_url":""}}')
check "clearing it falls back to config.php" "200" "$CODE"
check_contains "the config.php value is back in force" \
  '"public_base_url":"https://example.test"' "$(curl -s "$BASE/config-status")"

# Validation: the whole batch is rejected, so a save can never half-apply.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/settings" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d '{"settings":{"palplus.api_key":"not-a-palplus-key","store_name":"Should Not Apply"}}')
check "an invalid key is rejected" "422" "$CODE"
check_contains "with a field-level message" 'fieldErrors' "$(cat /tmp/dhs-r.json)"
check_contains "explaining the expected shape" 'pk_live_' "$(cat /tmp/dhs-r.json)"
check_contains "and nothing from the batch was saved" '"saved"' "$(curl -s -X POST "$BASE/admin/settings" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' -d '{"settings":{"store_name":"ok"}}')"
case "$(cat "$DATA_DIR/settings.json" 2>/dev/null)" in
  *"Should Not Apply"*) check "the valid field in a bad batch was not applied" "not_applied" "applied" ;;
  *) check "the valid field in a bad batch was not applied" "not_applied" "not_applied" ;;
esac

# https is required for callback URLs, because gateways refuse anything else.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/settings" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d '{"settings":{"public_base_url":"http://insecure.test"}}')
check "a non-HTTPS public URL is rejected" "422" "$CODE"
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/settings" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d '{"settings":{"public_base_url":"https://example.test"}}')
check "an HTTPS URL is accepted" "200" "$CODE"

# Settings that would let the console rewrite its own authorisation, or move the
# data directory, are not reachable through it at all.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/settings" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d '{"settings":{"admin_api_key":"pwned"}}')
check "admin_api_key cannot be written here" "422" "$CODE"
check_absent "and was not stored" 'pwned' "$(cat "$DATA_DIR/settings.json" 2>/dev/null)"
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/settings" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' \
  -d '{"settings":{"data_dir":"/tmp/elsewhere"}}')
check "data_dir cannot be written here either" "422" "$CODE"

check "the settings file is owner-only" "600" "$(stat -c '%a' "$DATA_DIR/settings.json")"

echo
echo -e "\033[1mIntegration test button\033[0m"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/admin/settings/test" \
  -H 'Content-Type: application/json' -d '{"integration":"palplus"}')
check "test endpoint without an admin key -> 401" "401" "$CODE"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/settings/test" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' -d '{"integration":"nope"}')
check "an unknown integration is refused" "422" "$CODE"

# The SMS provider is stubbed, so its test should genuinely pass end to end.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/settings/test" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' -d '{"integration":"smsotp"}')
check "testing the SMS provider -> 200" "200" "$CODE"
check_contains "reports the key is accepted" 'API key is accepted' "$(cat /tmp/dhs-r.json)"
check_contains "and shows the balance" 'Balance can cover the minimum' "$(cat /tmp/dhs-r.json)"

# An integration with no key must say so rather than fail obscurely.
# (Resend is the one left unconfigured: the gateways carry fake keys so the
# pricing checks below are reachable at all.)
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/admin/settings/test" \
  -H 'x-admin-key: test-admin-key' -H 'Content-Type: application/json' -d '{"integration":"resend"}')
check "testing an unconfigured integration -> 200" "200" "$CODE"
check_contains "explains that the key is missing" 'No Resend API key is set' "$(cat /tmp/dhs-r.json)"


echo
echo -e "\033[1mPrice tampering\033[0m"

# The store used to take the price from the request body and store it on the
# order, and the Palplus webhook compared the settled amount against that same
# stored value — so the "tamper check" compared a number with itself and a buyer
# could pay whatever they liked. NOWPayments had no amount check at all. These
# tests pin the replacement: the charge comes from the server's own catalog.

# A cart of proxy-dc-03 costs $17 in the catalog.
CHEAP_ORDER="ORDER_proxy-dc-03_tamper1"
"$PHP_BIN" -r '
  require $argv[1] . "/lib/http.php";
  require $argv[1] . "/lib/store.php";
  require $argv[1] . "/lib/dispatch.php";
  $config = ["data_dir" => $argv[2]];
  $num = 0;
  inventory_add_units($config, "proxy-dc-03", "203.0.11.1:9000:u:p", $num);
  store_write_order($config, [
    "order_id" => $argv[3], "order_token" => "tok_tamper", "status" => "pending",
    "gateway" => "nowpayments", "amount_usd" => 17, "currency" => "USD",
    "buyer_email" => "tamper@example.test",
    "items" => [["product_id" => "proxy-dc-03", "name" => "Datacenter Proxies", "quantity" => 1]],
  ]);' "$API_DIR" "$DATA_DIR" "$CHEAP_ORDER"

# The provider reports a price that does not match the catalog.
CODE=$(fire_ipn_with_amount "$CHEAP_ORDER" 0.01)
check "a settled amount below the catalog price -> 200 but rejected" "200" "$CODE"
check_contains "the webhook names the mismatch" '"rejected":"amount mismatch"' "$(cat /tmp/dhs-r.json)"

TAMPER_STATE=$("$PHP_BIN" -r '
  require $argv[1] . "/lib/http.php";
  require $argv[1] . "/lib/store.php";
  $o = store_read_order(["data_dir" => $argv[2]], $argv[3]);
  echo ($o["status"] ?? "") . "|" . ($o["failure_reason"] ?? "");' "$API_DIR" "$DATA_DIR" "$CHEAP_ORDER")
check "the underpaid order is failed, not fulfilled" "failed|amount_mismatch" "$TAMPER_STATE"

NO_GOODS=$(curl -s "$BASE/orders/credentials?orderId=$CHEAP_ORDER&token=tok_tamper" \
  | "$PHP_BIN" -r '$d = json_decode((string) stream_get_contents(STDIN), true); echo count($d["credentials"] ?? []);')
check "nothing is delivered for an underpaid order" "0" "$NO_GOODS"

# Paying the catalog price still settles it, so the check is not simply refusing
# every crypto order.
HONEST_ORDER="ORDER_proxy-dc-03_honest1"
"$PHP_BIN" -r '
  require $argv[1] . "/lib/http.php";
  require $argv[1] . "/lib/store.php";
  $config = ["data_dir" => $argv[2]];
  store_write_order($config, [
    "order_id" => $argv[3], "order_token" => "tok_honest", "status" => "pending",
    "gateway" => "nowpayments", "amount_usd" => 17, "currency" => "USD",
    "buyer_email" => "honest@example.test",
    "items" => [["product_id" => "proxy-dc-03", "name" => "Datacenter Proxies", "quantity" => 1]],
  ]);' "$API_DIR" "$DATA_DIR" "$HONEST_ORDER"

fire_paid_ipn "$HONEST_ORDER" >/dev/null
HONEST_STATE=$("$PHP_BIN" -r '
  require $argv[1] . "/lib/http.php";
  require $argv[1] . "/lib/store.php";
  $o = store_read_order(["data_dir" => $argv[2]], $argv[3]);
  echo ($o["status"] ?? "");' "$API_DIR" "$DATA_DIR" "$HONEST_ORDER")
check "the correct amount still settles" "paid" "$HONEST_STATE"

# The checkout endpoints refuse a cart priced differently from the catalog,
# BEFORE they talk to a provider or record anything.
TAMPER_CART='{"orderId":"ORDER_tamper_1","accountReference":"DHSTAMPER001","amountKes":1,"phone":"0712345678","items":[{"product_id":"proxy-dc-03","name":"Datacenter Proxies","quantity":1}]}'
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/palplus/initiate" \
  -H 'Content-Type: application/json' -d "$TAMPER_CART")
check "Palplus: a one-shilling cart is refused" "409" "$CODE"
check_contains "with a price-mismatch code" '"errorCode":"PRICE_MISMATCH"' "$(cat /tmp/dhs-r.json)"
check_absent "and no order was recorded" "ORDER_tamper_1" \
  "$(curl -s "$BASE/inventory/counts" | head -c 0; ls "$DATA_DIR" 2>/dev/null | grep -c 'ORDER_tamper_1' || true)"

CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/nowpayments/create-invoice" \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"ORDER_tamper_2","priceUsd":0.01,"items":[{"product_id":"proxy-dc-03","name":"Datacenter Proxies","quantity":1}]}')
check "NOWPayments: a one-cent invoice is refused" "409" "$CODE"
check_contains "with a price-mismatch code" '"errorCode":"PRICE_MISMATCH"' "$(cat /tmp/dhs-r.json)"

# A cart the server cannot price is refused outright rather than guessed at.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/palplus/initiate" \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"ORDER_tamper_3","accountReference":"DHSTAMPER003","amountKes":100,"phone":"0712345678","items":[{"product_id":"invented-product","name":"Nope","quantity":1}]}')
check "an unpriceable product is refused" "422" "$CODE"
check_contains "and says so" '"errorCode":"UNKNOWN_PRODUCT"' "$(cat /tmp/dhs-r.json)"

# An empty cart is not free.
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/nowpayments/create-invoice" \
  -H 'Content-Type: application/json' -d '{"orderId":"ORDER_tamper_4","priceUsd":5,"items":[]}')
check "an empty cart is refused" "422" "$CODE"
check_contains "as an empty cart" '"errorCode":"EMPTY_CART"' "$(cat /tmp/dhs-r.json)"

# The honest price must get past the tamper check (it then fails on the
# unreachable test gateway, which is a different, expected error).
CODE=$(curl -s -o /tmp/dhs-r.json -w '%{http_code}' -X POST "$BASE/nowpayments/create-invoice" \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"ORDER_tamper_5","priceUsd":17.00,"items":[{"product_id":"proxy-dc-03","name":"Datacenter Proxies","quantity":1}]}')
check_absent "the matching price is not refused as tampering" '"errorCode":"PRICE_MISMATCH"' "$(cat /tmp/dhs-r.json)"

echo
echo -e "\033[1mSummary\033[0m"
echo "  $PASS passed, $FAIL failed"
echo

exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
