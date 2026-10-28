<?php
/**
 * GET /api/admin/inventory/list      (admin key required)
 *
 * Per-product stock totals plus a small sample of available units, for the
 * admin stock screen.
 *
 * Response { products: [ { product_id, available, sold, total, sample, updated_at } ], totals }
 */

declare(strict_types=1);

require_once __DIR__ . '/../../lib/http.php';
require_once __DIR__ . '/../../lib/store.php';
require_once __DIR__ . '/../../lib/inventory.php';
require_once __DIR__ . '/../../lib/catalog.php';

$config = load_config();
apply_cors($config);
require_method('GET');
require_admin($config);

$rows = array_values(array_filter(
    inventory_summary($config),
    static fn (array $row): bool => !catalog_is_proxy((string) ($row['product_id'] ?? ''))
));

$available = 0;
$sold = 0;
foreach ($rows as $row) {
    $available += (int) $row['available'];
    $sold += (int) $row['sold'];
}

json_ok([
    'products' => $rows,
    'totals' => [
        'products' => count($rows),
        'available' => $available,
        'sold' => $sold,
    ],
]);
