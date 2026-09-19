<?php
/**
 * GET /api/admin/nextproxy-status      (admin key required)
 *
 * Live status of the on-demand proxy supply, for the admin console widget:
 * whether the provider answers, which tier the key unlocks, the pool size, a
 * few sample addresses, and the quota counters.
 *
 * About "credits" and cost, measured against a live key:
 *
 *   - Authenticated requests DO receive the documented credit headers
 *     (`x-credits-remaining`, `x-credits-used`). They are absent only for
 *     unauthenticated callers. A free key starts with 1,000 credits.
 *   - Every request that returns addresses costs 1 credit, regardless of
 *     `limit`: limit=1 and limit=100 both cost one.
 *   - `/api/health` is free, which is why the storefront's availability check
 *     uses it and never this endpoint.
 *   - There is no credits ROUTE: `/api/profile`, `/api/credits`, `/api/me` and
 *     `/api/account` all 404 even when authenticated.
 *
 * So `credits_remaining` is real when a key is configured, and null without one
 * — the endpoint reports what the provider actually says rather than inventing a
 * figure. `rate_remaining` is the separate per-minute request allowance.
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

// Flag a key that is running out, so the console can warn before orders start
// shortfalling. Only meaningful when a key is configured.
$credits = $status['credits_remaining'] ?? null;
$lowThreshold = (int) config_value($config, 'nextproxy.low_credits_warning', 100);
$lowCredits = is_int($credits) && $lowThreshold > 0 && $credits <= $lowThreshold;

json_ok([
    'status' => $status,
    'products' => $specs,
    'credits_low' => $lowCredits,
    'credits_low_threshold' => $lowThreshold,
    // What a refresh of this endpoint just cost, so the cost is not invisible.
    'probe_cost_credits' => $refresh ? 1 : 0,
    // Where the numbers above come from, so the UI can label them honestly.
    'credits_source' => $status['credits_source'] ?? null,
    'rate_limit_source' => $status['rate_limit'] !== null ? 'header' : null,
    'profile_configured' => trim((string) config_value($config, 'nextproxy.profile_path', '')) !== '',
]);
