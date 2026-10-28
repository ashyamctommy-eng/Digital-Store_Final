<?php
/**
 * GET /api/catalog
 * Public active product list. Prices and delivery metadata are server-owned.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/catalog.php';

$config = load_config();
apply_cors($config);
require_method('GET');

$products = catalog_products_runtime();
foreach ($products as &$product) {
    // Proxy stock must come from live provider fulfillment, never a manually
    // uploaded inventory count. Until the provider credential contract is
    // complete, keep those products visible but unavailable for purchase.
    if (($product['delivery_kind'] ?? '') === 'proxy') {
        $product['stock'] = 0;
    }
}
unset($product);

json_ok([
    'products' => $products,
    'generated_at' => gmdate('c'),
]);
