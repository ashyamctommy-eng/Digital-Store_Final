<?php
/**
 * GET /api/inventory/counts
 *
 * Public stock counts, derived from COUNT(available units). The storefront
 * overlays these onto the static catalog so stock always reflects what is
 * actually in the queue.
 *
 * Only products that HAVE inventory rows are returned. A product the admin has
 * not stocked yet keeps its catalog number, so enabling this cannot accidentally
 * empty the shop.
 *
 * For SMS products the response also lists which ones can be bought on demand.
 * `dynamic` means: no static stock left, but the provider is configured and
 * holds a spendable balance — so the storefront should stay purchasable rather
 * than showing Out of Stock.
 *
 * Proxy products are NOT listed here: they are stocked by hand and have no
 * on-demand source, so their availability is simply COUNT(available).
 *
 * Response {
 *   counts:  { "<product_id>": 12, ... },
 *   dynamic: [ "<product_id>", ... ],
 *   generated_at
 * }
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/inventory.php';
require_once __DIR__ . '/../lib/catalog.php';
require_once __DIR__ . '/../lib/smsotp.php';

$config = load_config();
apply_cors($config);
require_method('GET');

if (!config_value($config, 'inventory_drives_stock', true)) {
    json_ok(['counts' => [], 'dynamic' => [], 'generated_at' => gmdate('c'), 'disabled' => true]);
}

$counts = inventory_counts($config);

// Resolve on-demand availability once, not per product.
$dynamic = [];
$smsIds = catalog_sms_product_ids();

if ($smsIds && smsotp_is_configured($config)) {
    $balance = smsotp_balance_cached($config);
    $minimum = (float) config_value($config, 'smsotp.min_balance', 0.01);
    $hasFunds = $balance['ok'] && $balance['balance'] > $minimum;

    if ($hasFunds) {
        foreach ($smsIds as $id) {
            $static = $counts[$id] ?? 0;
            if ($static <= 0) {
                $dynamic[] = $id;
            }
        }
    }
}

json_ok([
    'counts' => $counts,
    // Products with no static stock that the provider can still fulfil.
    'dynamic' => $dynamic,
    'generated_at' => gmdate('c'),
]);
