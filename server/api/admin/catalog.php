<?php
/**
 * GET /api/admin/catalog
 * POST /api/admin/catalog { action: "save", product: {...} }
 * POST /api/admin/catalog { action: "delete"|"activate", productId: "..." }
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/catalog.php';

$config = load_config();
require_admin($config);
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
require_method($method === 'POST' ? 'POST' : 'GET');

if ($method === 'GET') {
    json_ok(['products' => catalog_products_runtime(true)]);
}

$body = read_json_body();
$action = clean_str($body['action'] ?? 'save', 24);
$overrides = product_catalog_read_overrides($config);

if ($action === 'delete' || $action === 'activate') {
    $productId = clean_str($body['productId'] ?? '', 64);
    $product = catalog_product_runtime($productId);
    if ($product === null) {
        json_error('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    }
    $product['active'] = $action === 'activate';
    unset($product['updated_at']);
    $overrides[$productId] = [
        'product' => array_diff_key($product, ['active' => true]),
        'active' => $action === 'activate',
        'updated_at' => gmdate('c'),
    ];
    if (!product_catalog_write_overrides($config, $overrides)) {
        json_error('Could not save the catalog. Check the data directory permissions.', 500, 'CATALOG_WRITE_FAILED');
    }
    json_ok([
        'product_id' => $productId,
        'active' => $action === 'activate',
        'products' => catalog_products_runtime(true),
    ]);
}

if ($action !== 'save') {
    json_error('Action must be save, delete or activate.', 422, 'INVALID_ACTION');
}

$input = is_array($body['product'] ?? null) ? $body['product'] : [];
$validation = product_catalog_validate($input);
if (!$validation['ok']) {
    json_response([
        'error' => 'Some product fields need attention.',
        'errorCode' => 'VALIDATION_FAILED',
        'fields' => $validation['errors'],
    ], 422);
}

$product = [
    'id' => trim((string) $input['id']),
    'slug' => trim((string) $input['slug']),
    'name' => trim((string) $input['name']),
    'category' => trim((string) $input['category']),
    'country_flags' => clean_str($input['country_flags'] ?? '🌐', 80) ?: '🌐',
    'price_usd' => round((float) $input['price_usd'], 2),
    'image' => trim((string) $input['image']),
    'stock' => (int) $input['stock'],
    'description' => trim((string) $input['description']),
    'specs' => array_values(array_map('trim', $input['specs'])),
    'guide_url' => trim((string) ($input['guide_url'] ?? '')),
    'delivery' => clean_str($input['delivery'] ?? 'Instant', 60) ?: 'Instant',
    'delivery_kind' => clean_str($input['delivery_kind'] ?? 'credentials', 16),
];
$original = $input['original_price_usd'] ?? null;
if (is_numeric($original) && (float) $original > 0) {
    $product['original_price_usd'] = round((float) $original, 2);
}
$badge = clean_str($input['badge'] ?? '', 40);
if ($badge !== '') {
    $product['badge'] = $badge;
}
if (!empty($input['featured'])) {
    $product['featured'] = true;
}
if ($product['delivery_kind'] === 'sms') {
    $sms = is_array($input['sms'] ?? null) ? $input['sms'] : [];
    $product['sms'] = [
        'service_id' => clean_str($sms['service_id'] ?? '', 40),
        'country_id' => clean_str($sms['country_id'] ?? '', 24),
        'server_id' => clean_str($sms['server_id'] ?? '1', 24),
        'label' => clean_str($sms['label'] ?? $product['name'], 60),
    ];
}
if ($product['delivery_kind'] === 'proxy') {
    $proxy = is_array($input['proxy'] ?? null) ? $input['proxy'] : [];
    $product['proxy'] = [
        'per_unit' => (int) $proxy['per_unit'],
        'label' => clean_str($proxy['label'] ?? 'Proxy access', 60),
        'pool_type' => clean_str($proxy['pool_type'] ?? 'res', 8),
        'country' => strtolower(clean_str($proxy['country'] ?? 'any', 3)),
        'protocol' => strtolower(clean_str($proxy['protocol'] ?? 'http', 8)),
    ];
    if (isset($proxy['data_gb']) && is_numeric($proxy['data_gb'])) {
        $product['proxy']['data_gb'] = (float) $proxy['data_gb'];
    }
}

$productId = $product['id'];
$existing = catalog_product_runtime($productId);
$overrides[$productId] = [
    'product' => $product,
    'active' => $existing === null ? true : !empty($existing['active']),
    'updated_at' => gmdate('c'),
];

if (!product_catalog_write_overrides($config, $overrides)) {
    json_error('Could not save the catalog. Check the data directory permissions.', 500, 'CATALOG_WRITE_FAILED');
}

json_ok([
    'product' => catalog_product_runtime($productId),
    'products' => catalog_products_runtime(true),
]);
