<?php
/**
 * POST /api/orders/proxies-check?order_id=…&token=…      (buyer)
 *
 * "Are the proxies I bought actually working?" — a buyer presses a button and
 * each address comes back with a tick or a cross.
 *
 * It deliberately tests ONLY the addresses recorded against that order. It is
 * not a general proxy-testing service: the order token authorises a read of one
 * order's own credentials, so there is no way to point this at arbitrary
 * addresses without buying them first. The per-request cap in
 * `proxycheck.max_buyer` bounds the work regardless.
 *
 * Response { order_id, results: [...], summary: {...}, egress_ip }
 *
 * A failing address is reported, never hidden: the buyer needs to know which
 * ones to swap out, and support needs the same list.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/proxyaddr.php';
require_once __DIR__ . '/../lib/proxycheck.php';

$config = load_config();
apply_cors($config);
require_method('POST');

// Checking an address and selling it are different acts: an owner may test a
// proxy that lives on their own network. Uploads stay strict, so this only
// widens what the checker will probe. Default off.
if ((bool) config_value($config, 'proxycheck.allow_private', false)) {
    proxy_set_allow_private(true);
}

// The id and token may arrive as query parameters or in a JSON body; a form post
// is easier from the storefront, and neither carries any more authority than the
// other.
$body = read_json_body();
$orderId = clean_str($body['order_id'] ?? ($_GET['order_id'] ?? ''), 96);
$token = clean_str($body['token'] ?? ($_GET['token'] ?? ''), 64);

if ($orderId === '') {
    json_error('order_id is required.', 422, 'MISSING_ORDER_ID');
}

$order = store_read_order($config, $orderId);
if ($order === null) {
    json_error('Unknown order.', 404, 'ORDER_NOT_FOUND');
}

$expected = (string) ($order['order_token'] ?? '');
if ($expected === '' || $token === '' || !hash_equals($expected, $token)) {
    store_log($config, 'orders.proxies_check.denied', ['order_id' => $orderId]);
    json_error('This link is not valid for that order.', 403, 'UNAUTHORIZED');
}

$deliverables = is_array($order['deliverables'] ?? null) ? $order['deliverables'] : [];

// Collect only this order's proxy addresses, with the credentials that were
// delivered alongside them.
$entries = [];
$byAddress = [];
foreach ($deliverables as $unit) {
    if (($unit['kind'] ?? '') !== 'proxy') {
        continue;
    }
    $auth = is_array($unit['proxy_auth'] ?? null) ? $unit['proxy_auth'] : [];
    foreach ((array) ($unit['proxies'] ?? []) as $address) {
        $address = (string) $address;
        if ($address === '' || isset($byAddress[$address])) {
            continue;
        }
        $byAddress[$address] = true;
        $pair = isset($auth[$address]) && is_string($auth[$address]) ? explode(':', $auth[$address], 2) : [];
        $entries[] = [
            'address' => $address,
            'username' => $pair[0] ?? '',
            'password' => $pair[1] ?? '',
            'scheme_hint' => '',
        ];
    }
}

if (!$entries) {
    json_ok([
        'order_id' => $orderId,
        'results' => [],
        'summary' => proxycheck_summary([]),
        'egress_ip' => null,
        'note' => 'This order has no proxy addresses to test.',
    ]);
}

$max = proxycheck_max($config, false);
$truncated = count($entries) > $max;

$started = microtime(true);
$outcome = proxycheck_many($config, $entries, false);
$elapsed = (int) round((microtime(true) - $started) * 1000);

store_log($config, 'orders.proxies_check', [
    'order_id' => $orderId,
    'checked' => count($outcome['results']),
    'healthy' => proxycheck_summary($outcome['results'])['healthy'],
    'elapsed_ms' => $elapsed,
]);

json_ok([
    'order_id' => $orderId,
    'results' => $outcome['results'],
    'summary' => proxycheck_summary($outcome['results']),
    'egress_ip' => $outcome['egress_ip'],
    'elapsed_ms' => $elapsed,
    'truncated' => $truncated,
    'max_checked' => $max,
    'error' => $outcome['error'],
]);
