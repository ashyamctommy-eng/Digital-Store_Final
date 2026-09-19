<?php
/**
 * GET /api/admin/nextproxy-status      (admin key required)
 *
 * Live status of the on-demand proxy supply, for the admin console widget:
 * whether the provider answers, which tier the key unlocks, the pool size, a
 * few sample addresses, and the quota counters.
 *
 * About "credits": the provider documents an `X-Credits-Remaining` header on a
 * credit-metered account and a developer console to recharge it, but neither
 * exists on the live service — `/api/profile` and `/api/credits` both 404 and
 * the documented headers are never sent. What is really returned is a
 * rate-limit window:
 *
 *     x-ratelimit-limit: 60
 *     x-ratelimit-remaining: 48
 *     x-ratelimit-reset: <unix>
 *
 * So this endpoint reports `rate_remaining` as the authoritative number and
 * labels it as a rate limit, and only reports `credits_remaining` when a real
 * credits source exists (a configured `nextproxy.profile_path`, or the
 * documented headers if the provider ever starts sending them). It does not
 * invent a credit balance.
 *
 * The API key is never returned — only a masked hint and where it came from.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/settings.php';
require_once __DIR__ . '/../lib/nextproxy.php';
require_once __DIR__ . '/../lib/catalog.php';

$config = load_config();
require_method('GET');
require_admin($config);

// `?refresh=1` bypasses the cache so the widget can offer a manual re-check.
$refresh = isset($_GET['refresh']) && $_GET['refresh'] !== '' && $_GET['refresh'] !== '0';
$status = $refresh
    ? nextproxy_probe($config)
    : nextproxy_status_cached($config);

$specs = [];
foreach (catalog_proxy_product_ids() as $id) {
    $spec = catalog_proxy_spec($id) ?? [];
    $specs[] = [
        'product_id' => $id,
        'label' => $spec['label'] ?? '',
        'country' => $spec['country'] ?? '',
        'protocol' => $spec['protocol'] ?? '',
        'per_unit' => (int) ($spec['per_unit'] ?? 1),
    ];
}

json_ok([
    'status' => $status,
    'products' => $specs,
    // Where the numbers above come from, so the UI can label them honestly.
    'credits_source' => $status['credits_source'] ?? null,
    'rate_limit_source' => $status['rate_limit'] !== null ? 'header' : null,
    'profile_configured' => trim((string) config_value($config, 'nextproxy.profile_path', '')) !== '',
]);
