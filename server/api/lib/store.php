<?php
/**
 * File-backed order ledger.
 *
 * A static cPanel plan has no database guarantee, so orders are stored as JSON
 * files. Every write uses an exclusive lock and an atomic rename, so concurrent
 * webhook + status-poll writes cannot corrupt a record.
 *
 * Layout (inside data_dir, which .htaccess blocks from HTTP):
 *   <orderId>.json      the order record
 *   ref_<accountRef>.json   { "order_id": "..." }  — maps the 12-char M-Pesa
 *                           reference back to the full order id
 */

declare(strict_types=1);

function store_data_dir(array $config): string
{
    $dir = (string) config_value($config, 'data_dir', __DIR__ . '/../data');
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

/** Strips anything that could escape the data directory. */
function store_safe_key(string $value): string
{
    $safe = preg_replace('/[^A-Za-z0-9_-]/', '', $value) ?? '';
    return $safe === '' ? 'unknown' : substr($safe, 0, 96);
}

function store_order_path(array $config, string $orderId): string
{
    return store_data_dir($config) . '/' . store_safe_key($orderId) . '.json';
}

function store_ref_path(array $config, string $accountRef): string
{
    return store_data_dir($config) . '/ref_' . store_safe_key($accountRef) . '.json';
}

/** Reads an order record, or null when it does not exist. */
function store_read_order(array $config, string $orderId): ?array
{
    $path = store_order_path($config, $orderId);
    if (!is_file($path)) {
        return null;
    }
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return null;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : null;
}

/**
 * Writes an order record atomically.
 * Also maintains the accountReference -> orderId index.
 */
function store_write_order(array $config, array $order): bool
{
    $orderId = (string) ($order['order_id'] ?? '');
    if ($orderId === '') {
        return false;
    }

    $order['updated_at'] = gmdate('c');
    if (!isset($order['created_at'])) {
        $order['created_at'] = $order['updated_at'];
    }

    $path = store_order_path($config, $orderId);
    $tmp = $path . '.' . getmypid() . '.tmp';
    $json = json_encode($order, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

    if ($json === false || @file_put_contents($tmp, $json, LOCK_EX) === false) {
        return false;
    }
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    @chmod($path, 0640);

    // Maintain the reverse index for webhook lookups.
    $accountRef = (string) ($order['account_reference'] ?? '');
    if ($accountRef !== '') {
        $refPath = store_ref_path($config, $accountRef);
        $refTmp = $refPath . '.tmp';
        if (@file_put_contents($refTmp, json_encode(['order_id' => $orderId]), LOCK_EX) !== false) {
            @rename($refTmp, $refPath);
            @chmod($refPath, 0640);
        }
    }

    return true;
}

/** Merges a patch into an existing order record. */
function store_update_order(array $config, string $orderId, array $patch): bool
{
    $order = store_read_order($config, $orderId);
    if ($order === null) {
        return false;
    }
    return store_write_order($config, array_merge($order, $patch));
}

/**
 * Resolves an order from a Palplus `external_reference`
 * (which is our 12-character accountReference).
 */
function store_find_by_account_reference(array $config, string $accountRef): ?array
{
    $refPath = store_ref_path($config, $accountRef);
    if (!is_file($refPath)) {
        return null;
    }
    $raw = @file_get_contents($refPath);
    $decoded = $raw === false ? null : json_decode($raw, true);
    $orderId = is_array($decoded) ? ($decoded['order_id'] ?? '') : '';
    if ($orderId === '') {
        return null;
    }
    return store_read_order($config, (string) $orderId);
}

/** Appends a line to the gateway audit log. */
function store_log(array $config, string $channel, array $entry): void
{
    $dir = store_data_dir($config);
    $line = json_encode(array_merge([
        'at' => gmdate('c'),
        'channel' => $channel,
    ], $entry), JSON_UNESCAPED_SLASHES);

    @file_put_contents($dir . '/events.log', $line . PHP_EOL, FILE_APPEND | LOCK_EX);
    @chmod($dir . '/events.log', 0640);
}
