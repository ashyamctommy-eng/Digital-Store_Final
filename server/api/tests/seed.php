<?php
/**
 * Seeds an order and some stock directly into a test data directory, so the
 * HTTP tests can exercise the webhook -> dispatch -> credentials path without
 * needing a live gateway account.
 *
 *   php seed.php <dataDir> <productId> <orderId> <orderToken> <qty> <email>
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/inventory.php';
require_once __DIR__ . '/../lib/dispatch.php';

$config = ['data_dir' => $argv[1]];

[$dataDir, $productId, $orderId, $token, $qty, $email] =
    [$argv[1], $argv[2], $argv[3], $argv[4], (int) $argv[5], $argv[6]];

$lines = [];
for ($i = 0; $i < $qty; $i++) {
    $lines[] = sprintf('SEED%d|secret%d|buyer%d@example.test', $i + 1, $i + 1, $i + 1);
}
inventory_add_units($config, $productId, implode("\n", $lines));

store_write_order($config, [
    'order_id' => $orderId,
    'order_token' => $token,
    'gateway' => 'nowpayments',
    'currency' => 'USD',
    'amount_usd' => 34.50,
    'status' => 'pending',
    'buyer_email' => $email,
    'items' => [
        ['product_id' => $productId, 'name' => 'Seeded Product', 'quantity' => $qty],
    ],
]);

echo json_encode([
    'seeded_units' => inventory_count_available($config, $productId),
    'order_id' => $orderId,
]) . PHP_EOL;
