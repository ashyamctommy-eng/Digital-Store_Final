<?php
/**
 * Worker used by the concurrency test: runs one claim in its own process.
 *
 *   php claim-worker.php <dataDir> <productId> <qty> <orderId>
 *
 * Prints the claimed unit ids as JSON.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/inventory.php';

$config = [
    'data_dir' => $argv[1],
    'inventory_drives_stock' => true,
];

$result = inventory_claim($config, $argv[2], (int) $argv[3], $argv[4]);

echo json_encode(array_column($result['units'], 'id'));
