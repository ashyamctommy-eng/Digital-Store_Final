<?php
/**
 * POST /api/admin/proxies/check        (admin key required)
 *
 * Tests proxies and ranks them, so stock can be judged before it is sold.
 *
 * Request (one of):
 *   { text: "user:pass@1.2.3.4:8080\n5.6.7.8:3128" }   check a pasted list
 *   { productId: "proxy-dc-03" }                       check what is in stock
 *   { productId: "proxy-dc-03", status: "available" }  (default)
 *
 * Response {
 *   results: [{ address, username, password, healthy, protocol, exit_ip,
 *               latency_ms, speed, anonymity, score, grade, error }],
 *   summary: { checked, healthy, dead, elite, median_latency_ms, best_score },
 *   egress_ip
 * }
 *
 * `results` is sorted best-first. The score is this store's own heuristic (see
 * lib/proxycheck.php) — it measures how well an address performs, not whether it
 * has a bad reputation.
 *
 * Credentials in the response are the ones that were supplied; they are shown
 * back to the admin who already holds them, never to a buyer.
 */

declare(strict_types=1);

require_once __DIR__ . '/../../lib/http.php';
require_once __DIR__ . '/../../lib/store.php';
require_once __DIR__ . '/../../lib/inventory.php';
require_once __DIR__ . '/../../lib/catalog.php';
require_once __DIR__ . '/../../lib/proxyaddr.php';
require_once __DIR__ . '/../../lib/proxycheck.php';

$config = load_config();
require_method('POST');
require_admin($config);

// Checking an address and selling it are different acts: an owner may test a
// proxy that lives on their own network. Uploads stay strict, so this only
// widens what the checker will probe. Default off.
if ((bool) config_value($config, 'proxycheck.allow_private', false)) {
    proxy_set_allow_private(true);
}

$body = read_json_body();
$text = is_string($body['text'] ?? null) ? (string) $body['text'] : '';
$productId = clean_str($body['productId'] ?? '', 96);

$entries = [];

if (trim($text) !== '') {
    // A pasted list is parsed with the same rules the uploader uses, so what is
    // tested is exactly what would be stored.
    $rejected = [];
    $units = inventory_parse_lines($text, 'proxy', $rejected);
    foreach ($units as $unit) {
        $entries[] = [
            'address' => (string) $unit['proxy'],
            'username' => (string) ($unit['username'] ?? ''),
            'password' => (string) ($unit['password'] ?? ''),
            'scheme_hint' => (string) ($unit['scheme_hint'] ?? ''),
        ];
    }
    if (!$entries) {
        json_error(
            'No usable addresses in that list.' . ($rejected ? ' ' . count($rejected) . ' line(s) were refused.' : ''),
            422,
            'NO_USABLE_ADDRESSES'
        );
    }
} elseif ($productId !== '') {
    if (!catalog_is_proxy($productId)) {
        json_error('That product is not a proxy product.', 422, 'NOT_A_PROXY_PRODUCT');
    }

    $wanted = clean_str($body['status'] ?? 'available', 20) ?: 'available';
    $data = inventory_read($config, $productId);
    foreach ($data['items'] as $item) {
        if (($item['status'] ?? '') !== $wanted) {
            continue;
        }
        $address = (string) ($item['proxy'] ?? $item['uid'] ?? '');
        if ($address === '') {
            continue;
        }
        $entries[] = [
            'address' => $address,
            'username' => (string) ($item['username'] ?? ''),
            'password' => (string) ($item['password'] ?? ''),
            'scheme_hint' => (string) ($item['scheme_hint'] ?? ''),
        ];
    }
    if (!$entries) {
        json_ok([
            'product_id' => $productId,
            'results' => [],
            'summary' => proxycheck_summary([]),
            'egress_ip' => null,
            'note' => 'Nothing in stock with that status.',
        ]);
    }
} else {
    json_error('Provide either `text` or `productId`.', 422, 'MISSING_INPUT');
}

$max = proxycheck_max($config, true);
$truncated = count($entries) > $max;

$started = microtime(true);
$outcome = proxycheck_many($config, $entries, true);
$elapsed = (int) round((microtime(true) - $started) * 1000);

store_log($config, 'admin.proxies.check', [
    'product_id' => $productId !== '' ? $productId : null,
    'checked' => count($outcome['results']),
    'healthy' => proxycheck_summary($outcome['results'])['healthy'],
    'elapsed_ms' => $elapsed,
]);

json_ok([
    'product_id' => $productId !== '' ? $productId : null,
    'results' => $outcome['results'],
    'summary' => proxycheck_summary($outcome['results']),
    'egress_ip' => $outcome['egress_ip'],
    'exported_via' => proxycheck_echo_url($config),
    'elapsed_ms' => $elapsed,
    'truncated' => $truncated,
    'max_checked' => $max,
    'error' => $outcome['error'],
]);
