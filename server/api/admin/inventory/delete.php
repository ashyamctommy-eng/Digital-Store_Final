<?php
/**
 * POST /api/admin/inventory/delete      (admin key required)
 *
 * Removes a single unit from the queue by its internal id — used to pull a
 * dead credential before it can be sold.
 *
 * Request  { productId, unitId }
 * Response { deleted: true }
 */

declare(strict_types=1);

require_once __DIR__ . '/../../lib/http.php';
require_once __DIR__ . '/../../lib/store.php';
require_once __DIR__ . '/../../lib/inventory.php';

$config = load_config();
require_method('POST');
require_admin($config);

$body = read_json_body();
$productId = clean_str($body['productId'] ?? '', 96);
$unitId = clean_str($body['unitId'] ?? '', 64);

if ($productId === '' || $unitId === '') {
    json_error('productId and unitId are required.', 422, 'MISSING_PARAMS');
}

if (!inventory_delete_unit($config, $productId, $unitId)) {
    json_error('No matching unit.', 404, 'UNIT_NOT_FOUND');
}

store_log($config, 'admin.inventory.delete', [
    'product_id' => $productId,
    'unit_id' => $unitId,
]);

json_ok([
    'deleted' => true,
    'available' => inventory_count_available($config, $productId),
]);
