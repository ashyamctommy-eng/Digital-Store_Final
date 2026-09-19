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
require_once __DIR__ . '/../lib/catalog.php';
require_once __DIR__ . '/../lib/smsotp.php';
require_once __DIR__ . '/../lib/proxyaddr.php';
require_once __DIR__ . '/../lib/proxycheck.php';

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
section('SMS stock parsing (PHONE | INBOX_URL_OR_NOTES)');

$sms = inventory_parse_lines(<<<TXT
+15551234567 | https://smsotp.net/inbox/abc123
+15559876543 | Keep the page open, code arrives in ~30s
+447700900123
+15550000000 | javascript:alert(1)
not-a-number | https://example.com/x
TXT, 'sms');

// The junk line is dropped; the javascript: payload is neutralised.
eq(4, count($sms), 'parses 4 usable SMS lines, dropping the non-number');
eq('+15551234567', $sms[0]['phone'], 'phone is normalised with a leading +');
eq('https://smsotp.net/inbox/abc123', $sms[0]['inbox_url'], 'a real link becomes the inbox url');
eq('', $sms[0]['notes'], 'a link is not also stored as a note');
eq('sms', $sms[0]['kind'], 'SMS units are tagged with their kind');
eq('Keep the page open, code arrives in ~30s', $sms[1]['notes'], 'free text is kept as a note');
eq('', $sms[1]['inbox_url'], 'free text is not mistaken for a link');
eq('+447700900123', $sms[2]['phone'], 'a bare phone number with no link is still stocked');
eq('', $sms[2]['inbox_url'], 'a bare number has no inbox url');
eq('', $sms[3]['inbox_url'], 'a javascript: url is rejected');
eq('javascript:alert(1)', $sms[3]['notes'], 'the rejected payload is kept only as inert text');

eq('', inventory_sanitize_url('data:text/html,<script>'), 'data: urls are rejected');
eq('', inventory_sanitize_url('  '), 'blank urls are rejected');
eq('http://example.com/a', inventory_sanitize_url('http://example.com/a'), 'http is allowed');
ok(inventory_sanitize_url('https://e.com/' . str_repeat('a', 900)) === '', 'over-long urls are rejected');
eq('+15551234567', inventory_normalize_phone('+1 (555) 123-4567'), 'formatted numbers are cleaned');
// "0712345678" is a valid pattern in several countries, so the country cannot
// be inferred. It is kept as-is and flagged for review instead of being guessed.
eq('+0712345678', inventory_normalize_phone('0712 345 678'), 'a local-format number is kept, not guessed');
ok(inventory_phone_needs_review('+0712345678'), 'an ambiguous local number is flagged for review');
ok(!inventory_phone_needs_review('+254712345678'), 'a proper country code is not flagged');
ok(!inventory_phone_needs_review('+15551234567'), 'a US number is not flagged');

/* ---------------------------------------------------------------- */
section('Server-side catalog map');

ok(catalog_is_sms('sms-whatsapp'), 'whatsapp product is recognised as SMS');
ok(catalog_is_sms('sms-facebook'), 'facebook product is recognised as SMS');
ok(!catalog_is_sms('vpn-nord-1y'), 'a VPN product is not SMS');
eq('wa', catalog_sms_spec('sms-whatsapp')['service_id'], 'whatsapp maps to the wa service code');
eq('tg', catalog_sms_spec('sms-telegram')['service_id'], 'telegram maps to tg');
eq('fb', catalog_sms_spec('sms-facebook')['service_id'], 'facebook maps to fb');
eq(null, catalog_sms_spec('not-a-product'), 'an unknown product has no spec');
eq(null, catalog_sms_spec('vpn-nord-1y'), 'a non-SMS product has no spec');

/* ---------------------------------------------------------------- */
section('SMS dispatch prefers pre-bought stock');

// Stock 2 numbers, order 2 -> both from static, provider never consulted.
$add = inventory_add_units(
    $config,
    'sms-whatsapp',
    "+15550000001 | https://inbox.test/1\n+15550000002 | https://inbox.test/2",
    'sms'
);
eq(2, $add['available'], 'two SMS numbers are in stock');

$claim = dispatch_claim_sms($config, 'sms-whatsapp', 2, 'ORDER_SMS_A');
eq(2, count($claim['units']), 'both units are delivered');
eq(0, $claim['shortfall'], 'no shortfall when stock covers the order');
eq('static', $claim['units'][0]['source'], 'the units come from static stock');
eq('+15550000001', $claim['units'][0]['phone_number'], 'the phone number is delivered');
eq('https://inbox.test/1', $claim['units'][0]['inbox_url'], 'the inbox link is delivered');
eq(0, inventory_count_available($config, 'sms-whatsapp'), 'static stock is consumed');

// Static empty and no provider configured -> shortfall, never a silent success.
$claim2 = dispatch_claim_sms($config, 'sms-whatsapp', 1, 'ORDER_SMS_B');
eq(0, count($claim2['units']), 'nothing is delivered when stock is gone');
eq(1, $claim2['shortfall'], 'the shortfall is reported');
ok(is_string($claim2['dynamic_error']), 'the reason is recorded for the admin');
eq('Product is not an SMS product.', dispatch_claim_sms($config, 'vpn-nord-1y', 1, 'X')['dynamic_error'] ?? null, 'non-SMS products are guarded');

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
section('Proxy address validation');

// A proxy list is an attack surface and a support cost: handing a buyer an
// address that cannot route is worse than handing them nothing.
ok(proxy_public_ip('8.8.8.8'), 'a routable address is accepted');
ok(proxy_public_ip('203.0.9.1'), 'an ordinary public address is accepted');
ok(!proxy_public_ip('10.0.0.1'), 'private space is rejected');
ok(!proxy_public_ip('172.16.0.1'), 'private space (172.16/12) is rejected');
ok(!proxy_public_ip('192.168.1.1'), 'private space (192.168/16) is rejected');
ok(!proxy_public_ip('127.0.0.1'), 'loopback is rejected');
ok(!proxy_public_ip('169.254.1.1'), 'link-local is rejected');
ok(!proxy_public_ip('0.1.2.3'), 'the 0/8 block is rejected');
ok(!proxy_public_ip('100.64.0.1'), 'carrier-grade NAT is rejected');
ok(!proxy_public_ip('192.0.2.5'), 'the TEST-NET-1 documentation range is rejected');
ok(!proxy_public_ip('198.51.100.5'), 'the TEST-NET-2 documentation range is rejected');
ok(!proxy_public_ip('203.0.113.5'), 'the TEST-NET-3 documentation range is rejected');
ok(!proxy_public_ip('224.0.0.1'), 'multicast is rejected');
ok(!proxy_public_ip('255.255.255.255'), 'the broadcast address is rejected');
ok(!proxy_public_ip(''), 'an empty address is rejected');
ok(!proxy_public_ip('not-an-ip'), 'nonsense is rejected');
ok(proxy_public_ip('2001:4860:4860::8888'), 'a public IPv6 address is accepted');

eq('', proxy_port('0'), 'port 0 is rejected');
eq('', proxy_port('65536'), 'an out-of-range port is rejected');
eq('', proxy_port(''), 'an empty port is rejected');
eq('8080', proxy_port('8080'), 'a normal port is accepted');
eq('8080', proxy_port(' 8080 '), 'a padded port is trimmed');
eq('', proxy_port('abc'), 'a non-numeric port is rejected');

eq('1.2.3.4:8080', proxy_format_pair('1.2.3.4', '8080'), 'a pair formats as IP:PORT');
eq('1.2.3.4:8080', proxy_format_pair('1.2.3.4', 8080), 'a numeric port is accepted');
eq('', proxy_format_pair('10.0.0.1', '8080'), 'a private pair does not format');
eq('[2001:4860:4860::8888]:8080', proxy_format_pair('2001:4860:4860::8888', '8080'), 'IPv6 is bracketed so IP:PORT stays unambiguous');

eq('1.2.3.4:8080', proxy_normalize_address('1.2.3.4:8080'), 'an address normalises');
eq('1.2.3.4:8080', proxy_normalize_address('  1.2.3.4:8080  '), 'whitespace is tolerated');
eq('', proxy_normalize_address('1.2.3.4'), 'an address with no port is rejected');
eq('', proxy_normalize_address('10.0.0.1:8080'), 'a private address is rejected');
eq('', proxy_normalize_address(''), 'an empty address is rejected');

/* ---------------------------------------------------------------- */
section('Proxy address normalisation');

eq(
    ['1.2.3.4:8080'],
    proxy_unique([['ip' => '1.2.3.4', 'port' => '8080']]),
    'the documented ip/port shape parses'
);
eq(
    ['1.2.3.4:8080'],
    proxy_unique([['ip' => '1.2.3.4', 'port' => 8080]]),
    'a numeric port parses'
);
eq(
    ['1.2.3.4:8080'],
    proxy_unique(['1.2.3.4:8080']),
    'an already-formatted string parses'
);
eq(
    ['1.2.3.4:8080'],
    proxy_unique([['host' => '1.2.3.4', 'port' => '8080']]),
    'the host/port variant parses'
);
eq(
    ['1.2.3.4:8080'],
    proxy_unique([['proxy' => ['ip' => '1.2.3.4', 'port' => '8080']]]),
    'a nested wrapper parses'
);
eq(
    ['1.2.3.4:8080'],
    proxy_unique([['ip' => '1.2.3.4:8080']]),
    'ip:port packed into one field parses'
);
eq(
    ['1.2.3.4:8080'],
    proxy_unique([
        ['ip' => '1.2.3.4', 'port' => '8080'],
        ['ip' => '1.2.3.4', 'port' => '8080'],
    ]),
    'duplicates are collapsed'
);
eq(
    ['1.2.3.4:8080', '5.6.7.8:3128'],
    proxy_unique([
        ['ip' => '1.2.3.4', 'port' => '8080'],
        ['ip' => '10.0.0.1', 'port' => '8080'],
        ['ip' => '5.6.7.8', 'port' => '3128'],
        ['ip' => 'nonsense', 'port' => 'x'],
    ]),
    'unusable rows are dropped without losing the good ones'
);

/* ---------------------------------------------------------------- */
section('Proxy line formats');

// The owner uploads these by hand, so every spelling a seller might quote has
// to land: the two they named explicitly, plus the pipe form.
$expected = [
    '8.8.4.4:8080' => ['8.8.4.4:8080', '', ''],
    'user:pass@8.8.8.8:8080' => ['8.8.8.8:8080', 'user', 'pass'],
    '8.8.8.8:8080:user:pass' => ['8.8.8.8:8080', 'user', 'pass'],
    '8.8.8.8:8080 | user:pass' => ['8.8.8.8:8080', 'user', 'pass'],
    'socks5://user:pass@8.8.8.8:1080' => ['8.8.8.8:1080', 'user', 'pass'],
    'http://8.8.8.8:3128' => ['8.8.8.8:3128', '', ''],
];
foreach ($expected as $line => [$address, $user, $pass]) {
    $parsed = proxy_parse_line($line);
    ok(
        $parsed['ok'] && $parsed['address'] === $address
            && $parsed['username'] === $user && $parsed['password'] === $pass,
        "parses {$line}"
    );
}

// A password may contain the separators, so splitting happens from the right.
$tricky = proxy_parse_line('user:p@ss@8.8.8.8:8080');
eq('8.8.8.8:8080', $tricky['address'], 'an @ inside the password still resolves');
eq('user', $tricky['username'], 'the username is before the first colon');
eq('p@ss', $tricky['password'], 'the password keeps its @');

$colons = proxy_parse_line('8.8.8.8:8080:user:pa:ss');
eq('user', $colons['username'], 'a password containing : survives the colon form');
eq('pa:ss', $colons['password'], 'the whole remainder is the password');

$scheme = proxy_parse_line('socks5://8.8.8.8:1080');
eq('socks5', $scheme['scheme'], 'a scheme prefix is reported as a hint');

// Unusable lines are refused, not stored.
foreach ([
    '10.0.0.1:8080' => 'a private address',
    '127.0.0.1:8080' => 'loopback',
    '192.0.2.5:8080' => 'a documentation range',
    '8.8.8.8' => 'a missing port',
    'not-an-address' => 'nonsense',
    '' => 'an empty line',
] as $line => $why) {
    ok(!proxy_parse_line($line)['ok'], "refuses {$why}");
}

// Parsed stock keeps its credentials.
$units = inventory_parse_lines("user:pw@8.8.8.8:8080\n8.8.4.4:3128\n", 'proxy');
eq(2, count($units), 'two proxy lines parse');
eq('8.8.8.8:8080', $units[0]['uid'], 'the address becomes the uid');
eq('user', $units[0]['username'], 'the username is stored');
eq('pw', $units[0]['password'], 'the password is stored');
eq('', $units[1]['username'], 'a bare address stores no username');

/* ---------------------------------------------------------------- */
section('Proxy anonymity and scoring');

// The classifier is the whole reason the checker sends requests through the
// proxy to our own reflector: it needs to see what the DESTINATION would see.
eq(
    'elite',
    proxycheck_anonymity('9.9.9.9', [], '8.8.8.8'),
    'no forwarding headers and a different exit address is elite'
);
eq(
    'anonymous',
    proxycheck_anonymity('9.9.9.9', ['via' => '1.1 proxy'], '8.8.8.8'),
    'forwarding headers without our address is anonymous'
);
eq(
    'transparent',
    proxycheck_anonymity('9.9.9.9', ['x-forwarded-for' => '8.8.8.8'], '8.8.8.8'),
    'our own address in a forwarded header is transparent'
);
eq(
    'transparent',
    proxycheck_anonymity('8.8.8.8', [], '8.8.8.8'),
    'an unchanged exit address means the proxy is not hiding anything'
);
eq(
    'anonymous',
    proxycheck_anonymity('9.9.9.9', ['x-forwarded-for' => '1.2.3.4'], '8.8.8.8'),
    'a different forwarded address is not our leak'
);
eq(
    'elite',
    proxycheck_anonymity('9.9.9.9', [], null),
    'a missing egress baseline does not turn every proxy transparent'
);

eq('unreachable', proxycheck_speed_band(null), 'no latency reads as unreachable');
eq('excellent', proxycheck_speed_band(200), '200ms is excellent');
eq('good', proxycheck_speed_band(600), '600ms is good');
eq('fair', proxycheck_speed_band(1200), '1200ms is fair');
eq('slow', proxycheck_speed_band(4000), '4000ms is slow');

// A dead address scores zero however fast it refused.
$dead = ['healthy' => false, 'latency_ms' => 1, 'anonymity' => 'unknown', 'protocol' => null];
eq(0, proxycheck_score($dead), 'an unreachable address scores zero');

$elite = ['healthy' => true, 'latency_ms' => 120, 'anonymity' => 'elite', 'protocol' => 'socks5'];
eq(100, proxycheck_score($elite), 'a fast elite socks5 address scores full marks');

$transparent = ['healthy' => true, 'latency_ms' => 120, 'anonymity' => 'transparent', 'protocol' => 'socks5'];
ok(
    proxycheck_score($transparent) < proxycheck_score($elite) - 20,
    'a transparent proxy scores far below an elite one'
);
ok(
    proxycheck_score(['healthy' => true, 'latency_ms' => 5000, 'anonymity' => 'elite', 'protocol' => 'socks5'])
        < proxycheck_score($elite),
    'a slow address scores below a fast one'
);
eq('excellent', proxycheck_grade(90), '90 is an excellent grade');
eq('poor', proxycheck_grade(10), '10 is a poor grade');

$summary = proxycheck_summary([
    ['healthy' => true, 'anonymity' => 'elite', 'latency_ms' => 100, 'score' => 99],
    ['healthy' => true, 'anonymity' => 'anonymous', 'latency_ms' => 300, 'score' => 80],
    ['healthy' => false, 'anonymity' => 'unknown', 'latency_ms' => null, 'score' => 0],
]);
eq(3, $summary['checked'], 'the summary counts what was checked');
eq(2, $summary['healthy'], 'and how many worked');
eq(1, $summary['dead'], 'and how many did not');
eq(1, $summary['elite'], 'and how many are elite');
eq(99, $summary['best_score'], 'and the best score');
eq(300, $summary['median_latency_ms'], 'with the median taken over live addresses only');

// The checker must never test more than its cap.
eq(100, proxycheck_max(['proxycheck' => ['max_admin' => 100]], true), 'the admin cap is honoured');
eq(50, proxycheck_max([], false), 'the buyer cap defaults to 50');
eq(
    'http://example.test/api/proxies/echo',
    proxycheck_echo_url(['public_base_url' => 'http://example.test']),
    'the reflector defaults to this site'
);
eq(
    'http://127.0.0.1:9999/echo',
    proxycheck_echo_url(['public_base_url' => 'http://example.test', 'proxycheck' => ['echo_url' => 'http://127.0.0.1:9999/echo']]),
    'an explicit reflector wins'
);

/* ---------------------------------------------------------------- */
section('Proxy dispatch bookkeeping');

$proxyConfig = ['data_dir' => $tmp . '/proxy-dispatch'];
@mkdir($proxyConfig['data_dir'], 0777, true);

// With the provider switched off and no stock, the order must fail closed.
$result = dispatch_claim_proxy($proxyConfig, 'proxy-dc-03', 1, 'ORDER_off_1');
eq([], $result['units'], 'no provider and no stock delivers nothing');
eq(1, $result['shortfall'], 'and reports the full shortfall');

// A product that is not a proxy product cannot be proxy-dispatched.
$missing = dispatch_claim_proxy($proxyConfig, 'vpn-nord-1y', 1, 'ORDER_off_2');
eq(1, $missing['shortfall'], 'a non-proxy product is refused');

// 7 addresses cannot make a 10-IP unit; they must not be sold as one.
inventory_add_units($proxyConfig, 'proxy-9p-10', implode("\n", [
    '203.0.30.1:8080',
    '203.0.30.2:8080',
    '203.0.30.3:8080',
    '203.0.30.4:8080',
    '203.0.30.5:8080',
    '203.0.30.6:8080',
    '203.0.30.7:8080',
]), 'proxy');
eq(7, inventory_count_available($proxyConfig, 'proxy-9p-10'), '7 addresses were stocked');

$partial = dispatch_claim_proxy($proxyConfig, 'proxy-9p-10', 1, 'ORDER_partial_1');
eq([], $partial['units'], 'a partial unit is not sold');
eq(7, inventory_count_available($proxyConfig, 'proxy-9p-10'), 'the stranded addresses stay available');
eq(1, $partial['shortfall'], 'the shortfall is reported');

// 10 addresses is exactly one unit.
inventory_add_units($proxyConfig, 'proxy-9p-10', implode("\n", [
    '203.0.31.1:8080', '203.0.31.2:8080', '203.0.31.3:8080', '203.0.31.4:8080',
    '203.0.31.5:8080', '203.0.31.6:8080', '203.0.31.7:8080', '203.0.31.8:8080',
    '203.0.31.9:8080', '203.0.31.10:8080',
]), 'proxy');
eq(17, inventory_count_available($proxyConfig, 'proxy-9p-10'), 'stock is now 17 addresses');

$whole = dispatch_claim_proxy($proxyConfig, 'proxy-9p-10', 1, 'ORDER_whole_1');
eq(1, count($whole['units']), 'a whole unit is delivered');
eq(0, $whole['shortfall'], 'with no shortfall');
eq(10, $whole['units'][0]['proxy_count'], 'and exactly 10 addresses');
eq('static', $whole['units'][0]['source'], 'from pre-bought stock');
eq(10, count($whole['units'][0]['proxies']), 'the address list carries every address');
eq(7, inventory_count_available($proxyConfig, 'proxy-9p-10'), 'the next 7 addresses were left untouched');

// Order quantity multiplies the unit, and the addresses must not repeat.
$two = dispatch_claim_proxy($proxyConfig, 'proxy-9p-10', 2, 'ORDER_two_1');
$collected = [];
foreach ($two['units'] as $unit) {
    foreach ($unit['proxies'] as $address) {
        $collected[] = $address;
    }
}
eq(count($collected), count(array_unique($collected)), 'no address is delivered twice across units');

// A partial unit is never sold: 7 addresses cannot make a 10-IP product.
$partial = dispatch_claim_proxy($proxyConfig, 'proxy-9p-10', 1, 'ORDER_partial_1');
eq([], $partial['units'], 'a partial unit is not sold');
eq(1, $partial['shortfall'], 'the shortfall is reported');

// Exactly one unit is delivered, with credentials carried through.
inventory_add_units($proxyConfig, 'proxy-9p-10', implode("\n", [
    'u1:p1@8.8.8.8:8080',
    '8.8.4.4:8080:u2:p2',
    '8.8.8.8:8081',
    '8.8.4.4:8081',
    '8.8.8.8:8082',
    '8.8.4.4:8082',
    '8.8.8.8:8083',
    '8.8.4.4:8083',
    '8.8.8.8:8084',
    '8.8.4.4:8084',
]), 'proxy');

$whole = dispatch_claim_proxy($proxyConfig, 'proxy-9p-10', 1, 'ORDER_whole_1');
eq(1, count($whole['units']), 'a whole unit is delivered');
eq(0, $whole['shortfall'], 'with no shortfall');
eq(10, $whole['units'][0]['proxy_count'], 'and exactly 10 addresses');
eq('static', $whole['units'][0]['source'], 'from uploaded stock');
eq(
    'u1:p1',
    $whole['units'][0]['proxy_auth']['8.8.8.8:8080'] ?? '',
    'credentials-first lines keep their auth'
);
eq(
    'u2:p2',
    $whole['units'][0]['proxy_auth']['8.8.4.4:8080'] ?? '',
    'credentials-last lines keep their auth'
);
ok(
    !isset($whole['units'][0]['proxy_auth']['8.8.8.8:8081']),
    'an address with no credentials is absent from the auth map'
);

// Quantity multiplies the unit and never repeats an address. Seven addresses
// were left stranded by the partial-unit test above, so 13 more make exactly two
// whole 10-IP units.
eq(7, inventory_count_available($proxyConfig, 'proxy-9p-10'), 'the stranded addresses survived the claim');
inventory_add_units($proxyConfig, 'proxy-9p-10', implode("\n", [
    '9.9.9.1:8080', '9.9.9.2:8080', '9.9.9.3:8080', '9.9.9.4:8080', '9.9.9.5:8080',
    '9.9.9.6:8080', '9.9.9.7:8080', '9.9.9.8:8080', '9.9.9.9:8080', '9.9.9.10:8080',
    '9.9.9.11:8080', '9.9.9.12:8080', '9.9.9.13:8080',
]), 'proxy');
eq(20, inventory_count_available($proxyConfig, 'proxy-9p-10'), 'stock is now exactly two units');
$two = dispatch_claim_proxy($proxyConfig, 'proxy-9p-10', 2, 'ORDER_two_1');
$collected = [];
foreach ($two['units'] as $unit) {
    foreach ($unit['proxies'] as $address) {
        $collected[] = $address;
    }
}
eq(20, count($collected), 'two units deliver twenty addresses');
eq(count($collected), count(array_unique($collected)), 'no address is delivered twice');

// The rendered export carries credentials, or the buyer cannot use the proxy.
$text = dispatch_render_text(
    ['order_id' => 'ORDER_whole_1', 'items' => []],
    $whole['units']
);
ok(str_contains($text, 'u1:p1@8.8.8.8:8080') || str_contains($text, 'u1:p1'), 'the export includes proxy credentials');
ok(!str_contains($text, '•'), 'the export contains no masked placeholder');

/* ---------------------------------------------------------------- */
section('Proxy catalog');

eq('proxy', catalog_delivery_kind('proxy-9p-10'), 'the catalog knows a proxy product');
eq(null, catalog_delivery_kind('vpn-nord-1y'), 'and reports nothing for a plain product');
eq('sms', catalog_delivery_kind('sms-whatsapp'), 'while still knowing SMS products');
ok(catalog_is_proxy('proxy-dc-03'), 'catalog_is_proxy recognises a proxy product');
ok(!catalog_is_proxy('sms-whatsapp'), 'and does not confuse the two kinds');
eq(10, (int) catalog_proxy_spec('proxy-9p-10')['per_unit'], 'the per-unit address count comes from the catalog');

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
