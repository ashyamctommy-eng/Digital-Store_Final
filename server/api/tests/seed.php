<?php
/**
 * Seeds stock and/or an order directly into a test data directory, so the HTTP
 * tests can drive the webhook -> dispatch -> credentials path without a live
 * gateway account.
 *
 *   php seed.php <dataDir> <productId> <orderId> <token> <stockUnits> <orderQty> <email>
 *
 * `stockUnits` is how many units to ADD to inventory (0 to leave stock alone,
 * which is how the on-demand fallback gets exercised).
 * `orderQty` is the quantity on the order itself.
 *
 * The line format follows the product's delivery kind from the generated
 * catalog: phone|inbox for SMS products, UID|Password|Email otherwise.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/inventory.php';
require_once __DIR__ . '/../lib/dispatch.php';
require_once __DIR__ . '/../lib/catalog.php';

$config = ['data_dir' => $argv[1]];

[$dataDir, $productId, $orderId, $token, $stockUnits, $orderQty, $email] = [
    $argv[1],
    $argv[2],
    $argv[3],
    $argv[4],
    (int) $argv[5],
    (int) ($argv[6] ?? 1),
    $argv[7] ?? 'buyer@example.test',
];

$isSms = catalog_is_sms($productId);

if ($stockUnits > 0) {
    $lines = [];
    for ($i = 0; $i < $stockUnits; $i++) {
        $lines[] = $isSms
            ? sprintf('+1555999%04d | https://inbox.test/seed%d', $i, $i + 1)
            : sprintf('SEED%d|secret%d|buyer%d@example.test', $i + 1, $i + 1, $i + 1);
    }
    inventory_add_units($config, $productId, implode("\n", $lines), $isSms ? 'sms' : 'credentials');
}

store_write_order($config, [
    'order_id' => $orderId,
    'order_token' => $token,
    'gateway' => 'nowpayments',
    'currency' => 'USD',
    'amount_usd' => 4.50,
    'status' => 'pending',
    'buyer_email' => $email,
    'items' => [
        ['product_id' => $productId, 'name' => 'Seeded Product', 'quantity' => max(1, $orderQty)],
    ],
]);

echo json_encode([
    'product_id' => $productId,
    'kind' => $isSms ? 'sms' : 'credentials',
    'stock_added' => $stockUnits,
    'available' => inventory_count_available($config, $productId),
    'order_id' => $orderId,
]) . PHP_EOL;
