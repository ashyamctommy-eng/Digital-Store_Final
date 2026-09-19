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

require_once __DIR__ . '/http.php';

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

/**
 * Lists order records, newest first.
 *
 * The data directory also holds the reference index, settings and the audit
 * log, so the scan keeps only files that actually decode to an order record
 * (they carry an `order_id`) instead of trusting a filename pattern.
 *
 * `$status` filters to one status; `$search` matches order id, account
 * reference, buyer email or phone, case-insensitively.
 *
 * @return array{orders: list<array>, scanned: int, truncated: bool}
 */
function store_list_orders(array $config, int $limit = 200, string $status = '', string $search = ''): array
{
    $dir = store_data_dir($config);
    $limit = max(1, min(1000, $limit));

    $orders = [];
    $truncated = false;
    $scanned = 0;

    // NOTE: reads happen while other requests may be writing. store_write_order
    // renames into place, so a reader sees either the old file or the new one,
    // never a half-written one — no lock needed here.
    $entries = @scandir($dir);
    if ($entries === false) {
        return ['orders' => [], 'scanned' => 0, 'truncated' => false];
    }

    $search = strtolower(trim($search));

    foreach ($entries as $entry) {
        if (str_ends_with($entry, '.json') === false) {
            continue;
        }
        // ref_<accountReference>.json is an index, not an order.
        if (str_starts_with($entry, 'ref_')) {
            continue;
        }

        // Upper bound on the scan so a directory full of logs cannot make this
        // endpoint slow enough to matter.
        if ($scanned >= 5000) {
            $truncated = true;
            break;
        }

        $raw = @file_get_contents($dir . '/' . $entry);
        if ($raw === false || $raw === '') {
            continue;
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded) || !isset($decoded['order_id'])) {
            continue;
        }
        $scanned++;

        if ($status !== '' && (string) ($decoded['status'] ?? '') !== $status) {
            continue;
        }

        if ($search !== '') {
            $haystack = strtolower(implode(' ', array_filter([
                (string) ($decoded['order_id'] ?? ''),
                (string) ($decoded['account_reference'] ?? ''),
                (string) ($decoded['buyer_email'] ?? ''),
                (string) ($decoded['phone'] ?? ''),
                (string) ($decoded['buyer_name'] ?? ''),
            ], static fn ($v) => $v !== '')));
            if (str_contains($haystack, $search) === false) {
                continue;
            }
        }

        $orders[] = $decoded;
    }

    usort(
        $orders,
        static fn (array $a, array $b): int =>
            strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''))
    );

    if (count($orders) > $limit) {
        $orders = array_slice($orders, 0, $limit);
        $truncated = true;
    }

    return ['orders' => $orders, 'scanned' => $scanned, 'truncated' => $truncated];
}

/** Statuses an order can legitimately hold. */
function store_order_statuses(): array
{
    return ['pending', 'paid', 'delivered', 'failed', 'refunded'];
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
