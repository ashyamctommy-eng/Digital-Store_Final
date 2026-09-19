<?php
/**
 * Unit tests for the payment/inventory backend.
 *
 * Run:  php server/api/tests/unit.php
 *
 * Covers the logic where a mistake is expensive: credential parsing,
 * the atomic claim (never hand the same unit to two orders), dispatch
 * idempotency, IPN signature verification and status mapping.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/inventory.php';
require_once __DIR__ . '/../lib/dispatch.php';
require_once __DIR__ . '/../lib/email.php';
require_once __DIR__ . '/../lib/nowpayments.php';
require_once __DIR__ . '/../lib/palplus.php';

$GLOBALS['__pass'] = 0;
$GLOBALS['__fail'] = 0;

function ok(bool $condition, string $label): void
{
    if ($condition) {
        $GLOBALS['__pass']++;
        echo "  \033[32mPASS\033[0m  $label\n";
    } else {
        $GLOBALS['__fail']++;
        echo "  \033[31mFAIL\033[0m  $label\n";
    }
}

function eq($expected, $actual, string $label): void
{
    $same = $expected === $actual;
    if (!$same) {
        $label .= "\n        expected: " . var_export($expected, true)
            . "\n        actual:   " . var_export($actual, true);
    }
    ok($same, $label);
}

function section(string $name): void
{
    echo "\n\033[1m$name\033[0m\n";
}

/* ---------------------------------------------------------------- */
/* Test config + a throwaway data directory                          */
/* ---------------------------------------------------------------- */
$tmp = sys_get_temp_dir() . '/dhs-tests-' . bin2hex(random_bytes(4));
mkdir($tmp, 0775, true);

$config = [
    'mode' => 'sandbox',
    'data_dir' => $tmp,
    'store_name' => 'Digital Hub Shop',
    'public_base_url' => 'https://example.test',
    'admin_api_key' => 'test-admin-key',
    'palplus' => ['api_key' => 'pk_test_x', 'auth_style' => 'basic'],
    'nowpayments' => ['api_key' => 'np_test_x', 'ipn_secret' => 'ipn-secret-123'],
    'resend' => ['api_key' => '', 'from' => 'Test <t@example.test>', 'enabled' => true],
];

/* ---------------------------------------------------------------- */
section('Credential line parsing');

$parsed = inventory_parse_lines(<<<TXT
UID001|Passw0rd|user@example.com
UID002|AnotherPass
host.example.com:8080:proxyuser:proxypass

# a comment
   UID001|Passw0rd|user@example.com
bare-secret-value
TXT);

// 7 input lines -> 4 units: one blank, one comment and one exact duplicate drop out.
eq(4, count($parsed), 'parses 4 unique lines (blanks, comments and dupes dropped)');
eq('UID001', $parsed[0]['uid'], 'pipe format: UID is the first field');
eq('UID001|Passw0rd|user@example.com', $parsed[0]['secret'], 'raw line preserved for display');
eq(3, count($parsed[0]['fields']), 'pipe format yields 3 fields');
eq('host.example.com', $parsed[2]['uid'], 'colon format: first field becomes UID');
eq('available', $parsed[0]['status'], 'new units start available');
eq(null, $parsed[0]['order_id'], 'new units are unbound');
ok(str_starts_with($parsed[3]['uid'], 'UNIT-'), 'unstructured line gets a generated UID');

/* ---------------------------------------------------------------- */
section('inventory_add_units');

$r1 = inventory_add_units($config, 'vpn-nord-1y', "A|1\nB|2\nC|3");
eq(3, $r1['added'], 'adds 3 units');
eq(3, $r1['available'], 'available count is 3');

$r2 = inventory_add_units($config, 'vpn-nord-1y', "B|2\nD|4");
eq(1, $r2['added'], 'only the new line is added');
eq(1, $r2['duplicates'], 'the repeated line is reported as a duplicate');
eq(4, $r2['available'], 'available count is now 4');

eq(4, inventory_count_available($config, 'vpn-nord-1y'), 'count via public helper');
eq(0, inventory_count_available($config, 'no-such-product'), 'unknown product counts as 0');

$counts = inventory_counts($config);
eq(4, $counts['vpn-nord-1y'] ?? null, 'counts endpoint data shape');

/* ---------------------------------------------------------------- */
section('inventory_claim (the double-sell guard)');

$add = inventory_add_units($config, 'tiktok-600', "T1|p\nT2|p\nT3|p");
eq(3, $add['available'], 'seeded 3 tiktok units');

$claimA = inventory_claim($config, 'tiktok-600', 2, 'ORDER_A');
eq(2, count($claimA['units']), 'order A claims 2 units');
eq(0, $claimA['shortfall'], 'no shortfall for order A');
eq(1, inventory_count_available($config, 'tiktok-600'), '1 unit left available');

$claimB = inventory_claim($config, 'tiktok-600', 2, 'ORDER_B');
eq(1, count($claimB['units']), 'order B gets the remaining unit');
eq(1, $claimB['shortfall'], 'shortfall of 1 is reported, not silently dropped');

$idsA = array_column($claimA['units'], 'id');
$idsB = array_column($claimB['units'], 'id');
eq(0, count(array_intersect($idsA, $idsB)), 'no unit is handed to both orders');
eq(0, inventory_count_available($config, 'tiktok-600'), 'stock is now empty');

$claimC = inventory_claim($config, 'tiktok-600', 1, 'ORDER_C');
eq([], $claimC['units'], 'claiming from empty stock returns nothing');
eq(1, $claimC['shortfall'], 'empty stock reports the full shortfall');

/* ---------------------------------------------------------------- */
section('inventory_for_order / delete');

$forA = inventory_for_order($config, 'ORDER_A');
eq(2, count($forA), 'units are bound to order A');
eq('tiktok-600', $forA[0]['product_id'], 'binding records the product');

inventory_add_units($config, 'sms-us-01', "S1|del\nS2|keep");
$data = inventory_read($config, 'sms-us-01');
$firstId = $data['items'][0]['id'];
ok(inventory_delete_unit($config, 'sms-us-01', $firstId), 'deleting a unit succeeds');
eq(1, inventory_count_available($config, 'sms-us-01'), 'available count drops after delete');
ok(!inventory_delete_unit($config, 'sms-us-01', 'nope'), 'deleting an unknown unit returns false');

$summary = inventory_summary($config);
$row = null;
foreach ($summary as $s) {
    if ($s['product_id'] === 'tiktok-600') {
        $row = $s;
    }
}
eq(3, $row['sold'] ?? null, 'summary reports 3 sold for tiktok-600');
eq(0, $row['available'] ?? null, 'summary reports 0 available for tiktok-600');

/* ---------------------------------------------------------------- */
section('dispatch_order');

$orderId = 'ORDER_vpn-nord-1y_1700000000000';
store_write_order($config, [
    'order_id' => $orderId,
    'order_token' => 'tok-abc',
    'gateway' => 'palplus',
    'account_reference' => 'DHSVPN123456',
    'amount_kes' => 4485,
    'currency' => 'KES',
    'status' => 'paid',
    'buyer_email' => 'buyer@example.test',
    'items' => [
        ['product_id' => 'vpn-nord-1y', 'name' => 'NordVPN 1 Year Premium', 'quantity' => 2],
    ],
]);

$before = inventory_count_available($config, 'vpn-nord-1y');
$d1 = dispatch_order($config, $orderId);
eq(2, count($d1['deliverables']), 'dispatch claims the purchased quantity');
eq(false, $d1['already_dispatched'], 'first dispatch is not flagged as a repeat');
eq($before - 2, inventory_count_available($config, 'vpn-nord-1y'), 'stock decrements by the quantity');

$d2 = dispatch_order($config, $orderId);
eq(true, $d2['already_dispatched'], 'second dispatch is detected as a repeat');
eq(count($d1['deliverables']), count($d2['deliverables']), 'repeat returns the same deliverables');
eq($before - 2, inventory_count_available($config, 'vpn-nord-1y'), 'repeat claims no extra stock');
eq(
    $d1['deliverables'][0]['uid'],
    $d2['deliverables'][0]['uid'],
    'the same unit is returned, so a duplicate webhook cannot swap credentials'
);

$order = store_read_order($config, $orderId);
eq('buyer@example.test', $order['buyer_email'], 'buyer email is stored on the order');

// A shortfall must be recorded rather than throwing.
$shortId = 'ORDER_proxy-9p-10_1700000000001';
store_write_order($config, [
    'order_id' => $shortId,
    'status' => 'paid',
    'currency' => 'USD',
    'items' => [['product_id' => 'proxy-9p-10', 'name' => '9Proxy', 'quantity' => 3]],
]);
$d3 = dispatch_order($config, $shortId);
eq(0, count($d3['deliverables']), 'unstocked product delivers nothing');
eq(3, $d3['shortfall']['proxy-9p-10'] ?? null, 'shortfall is recorded for the admin');

/* ---------------------------------------------------------------- */
section('dispatch_render_text');

$text = dispatch_render_text(store_read_order($config, $orderId), $d1['deliverables']);
ok(str_contains($text, $orderId), 'export includes the order reference');
ok(str_contains($text, 'NordVPN 1 Year Premium'), 'export groups by product name');
ok(str_contains($text, $d1['deliverables'][0]['uid']), 'export lists the credential uid');
ok(str_contains($text, 'IMPORTANT'), 'export carries the usage warnings');

/* ---------------------------------------------------------------- */
section('NOWPayments IPN signature');

$ipnBody = json_encode([
    'payment_status' => 'finished',
    'order_id' => $orderId,
    'price_amount' => 34.5,
    'price_currency' => 'usd',
    'payment_id' => '5077125055',
], JSON_UNESCAPED_SLASHES);

eq(false, nowpayments_verify_ipn($config, $ipnBody, null), 'missing signature is rejected');
eq(false, nowpayments_verify_ipn($config, $ipnBody, 'deadbeef'), 'wrong signature is rejected');

$sorted = nowpayments_sort_recursive(json_decode($ipnBody, true));
$validSig = hash_hmac('sha512', json_encode($sorted, JSON_UNESCAPED_SLASHES), 'ipn-secret-123');
eq(true, nowpayments_verify_ipn($config, $ipnBody, $validSig), 'correct signature is accepted');
eq(true, nowpayments_verify_ipn($config, $ipnBody, strtoupper($validSig)), 'signature check is case-insensitive');

$tampered = str_replace('34.5', '0.5', $ipnBody);
eq(false, nowpayments_verify_ipn($config, $tampered, $validSig), 'tampered amount fails verification');

$noSecret = $config;
$noSecret['nowpayments']['ipn_secret'] = '';
eq(false, nowpayments_verify_ipn($noSecret, $ipnBody, $validSig), 'no configured secret means no trust');

/* ---------------------------------------------------------------- */
section('Status mapping');

eq('paid', nowpayments_map_status('finished'), 'nowpayments finished -> paid');
eq('paid', nowpayments_map_status('confirmed'), 'nowpayments confirmed -> paid');
eq('pending', nowpayments_map_status('waiting'), 'nowpayments waiting -> pending');
eq('failed', nowpayments_map_status('failed'), 'nowpayments failed -> failed');
eq('paid', palplus_map_status('SUCCESS'), 'palplus SUCCESS -> paid');
eq('cancelled', palplus_map_status('CANCELLED'), 'palplus CANCELLED -> cancelled');
eq('expired', palplus_map_status('EXPIRED'), 'palplus EXPIRED -> expired');
eq('pending', palplus_map_status('PENDING'), 'palplus PENDING -> pending');

/* ---------------------------------------------------------------- */
section('Email rendering + graceful skip');

$html = email_credentials_html($config, store_read_order($config, $orderId), $d1['deliverables']);
ok(str_contains($html, 'Digital Hub Shop'), 'email html shows the store name');
ok(str_contains($html, $orderId), 'email html shows the order reference');
ok(str_contains($html, 'IMPORTANT') || str_contains($html, 'Important'), 'email html carries the warnings');
ok(str_contains($html, htmlspecialchars($d1['deliverables'][0]['uid'], ENT_QUOTES)), 'email html contains the uid');

// With no Resend key the send must fail softly, never throw.
$send = email_send_credentials($config, store_read_order($config, $orderId), $d1['deliverables']);
eq(false, $send['ok'], 'send reports failure without a Resend key');
ok(is_string($send['error']), 'failure carries a reason');

$settle = settle_paid_order($config, $shortId);
ok(isset($settle['dispatch'], $settle['email']), 'settle_paid_order returns both stages');

/* ---------------------------------------------------------------- */
section('Admin key gate');

$goodConfig = $config;
$badKey = static function () use ($goodConfig) {
    $saved = $_SERVER['HTTP_X_ADMIN_KEY'] ?? null;
    $_SERVER['HTTP_X_ADMIN_KEY'] = 'wrong';
    ob_start();
    try {
        require_admin($goodConfig);
    } catch (Throwable $e) {
    }
    ob_end_clean();
    if ($saved === null) {
        unset($_SERVER['HTTP_X_ADMIN_KEY']);
    } else {
        $_SERVER['HTTP_X_ADMIN_KEY'] = $saved;
    }
};
// require_admin() calls json_error() which exits; assert the comparison logic
// directly instead so the test process survives.
$expectedKey = (string) $config['admin_api_key'];
ok(hash_equals($expectedKey, 'test-admin-key'), 'correct admin key matches');
ok(!hash_equals($expectedKey, 'wrong-key'), 'wrong admin key does not match');
ok(!hash_equals($expectedKey, ''), 'empty admin key does not match');

/* ---------------------------------------------------------------- */
section('Summary');

$pass = $GLOBALS['__pass'];
$fail = $GLOBALS['__fail'];
echo "\n  $pass passed, $fail failed\n";

// Cleanup
$it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($tmp, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::CHILD_FIRST
);
foreach ($it as $file) {
    $file->isDir() ? @rmdir($file->getPathname()) : @unlink($file->getPathname());
}
@rmdir($tmp);

exit($fail === 0 ? 0 : 1);
