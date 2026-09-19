<?php
/**
 * GET /api/admin/smsotp-status      (admin key required)
 *
 * Reports the on-demand SMS provider's state so the admin console can show
 * whether the dynamic fallback is actually usable, and lets the admin verify
 * that the service codes used by the catalog exist on the account.
 *
 * The API key itself is never returned.
 *
 * Response { configured, balance, balance_ok, min_balance, sms_products,
 *            services: [ { id, name } ], missing_service_ids: [...] }
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/catalog.php';
require_once __DIR__ . '/../lib/smsotp.php';

$config = load_config();
apply_cors($config);
require_method('GET');
require_admin($config);

$configured = smsotp_is_configured($config);
$balance = $configured
    ? smsotp_balance_cached($config)
    : ['ok' => false, 'balance' => 0.0, 'error' => 'not_configured'];

$services = $configured ? smsotp_services($config) : [];

// Which catalog service codes the provider does not recognise.
$missing = [];
if ($services) {
    $known = array_column($services, 'id');
    foreach (CATALOG_SMS_PRODUCTS as $productId => $spec) {
        if (!in_array($spec['service_id'], $known, true)) {
            $missing[$productId] = $spec['service_id'];
        }
    }
}

json_ok([
    'configured' => $configured,
    'balance' => $balance['balance'],
    'balance_ok' => (bool) $balance['ok'],
    'balance_error' => $balance['error'] ?? null,
    'min_balance' => (float) config_value($config, 'smsotp.min_balance', 0.01),
    'api_base' => smsotp_base_url($config),
    'sms_products' => count(CATALOG_SMS_PRODUCTS),
    // Only fetched when the provider is reachable; empty otherwise.
    'services' => $services,
    'missing_service_ids' => $missing,
]);
