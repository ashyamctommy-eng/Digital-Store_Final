<?php
/**
 * POST /api/admin/inventory/add      (admin key required)
 *
 * Bulk credential upload. The admin pastes one unit per line; each is parsed
 * and appended to the `inventory_stock` queue for that product as `available`.
 *
 * Request  { productId, text, dryRun? }
 * Response { product_id, added, duplicates, available, skipped: [...] }
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
$text = is_string($body['text'] ?? null) ? (string) $body['text'] : '';
$dryRun = !empty($body['dryRun']);

if ($productId === '') {
    json_error('productId is required.', 422, 'MISSING_PRODUCT_ID');
}
if (trim($text) === '') {
    json_error('No credential lines were provided.', 422, 'EMPTY_INPUT');
}

// Guard against a pasted novel filling the disk.
$maxLines = (int) config_value($config, 'max_inventory_lines', 5000);
$parsed = inventory_parse_lines($text);
if (count($parsed) > $maxLines) {
    json_error(
        'That is ' . count($parsed) . ' lines; the limit per upload is ' . $maxLines . '.',
        413,
        'TOO_MANY_LINES'
    );
}

// Surface anything that could not be split into fields, so the admin can spot
// malformed lines before committing them to stock.
$skipped = [];
foreach ($parsed as $unit) {
    if (count($unit['fields']) < 2) {
        $skipped[] = $unit['secret'];
    }
}

if ($dryRun) {
    json_ok([
        'product_id' => $productId,
        'dry_run' => true,
        'parsed' => count($parsed),
        'preview' => array_slice(array_map(
            static fn ($u) => ['uid' => $u['uid'], 'secret' => $u['secret']],
            $parsed
        ), 0, 10),
        'needs_review' => array_slice($skipped, 0, 20),
    ]);
}

$result = inventory_add_units($config, $productId, $text);

store_log($config, 'admin.inventory.add', [
    'product_id' => $productId,
    'parsed' => count($parsed),
    'added' => $result['added'],
    'duplicates' => $result['duplicates'],
]);

json_ok([
    'product_id' => $productId,
    'added' => $result['added'],
    'duplicates' => $result['duplicates'],
    'available' => $result['available'],
    'needs_review' => array_slice($skipped, 0, 20),
]);
