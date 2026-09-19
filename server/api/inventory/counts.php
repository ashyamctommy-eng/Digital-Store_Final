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
 * Response { counts: { "<product_id>": 12, ... }, generated_at }
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/inventory.php';

$config = load_config();
apply_cors($config);
require_method('GET');

if (!config_value($config, 'inventory_drives_stock', true)) {
    json_ok(['counts' => [], 'generated_at' => gmdate('c'), 'disabled' => true]);
}

json_ok([
    'counts' => inventory_counts($config),
    'generated_at' => gmdate('c'),
]);
