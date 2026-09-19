<?php
/**
 * inventory_stock queue.
 *
 * One JSON file per product holds every credential unit. Units move
 * `available` -> `sold` exactly once, bound to an order id.
 *
 * Correctness matters more than speed here: handing the same credential to two
 * buyers is the worst bug this store can have. Every mutation therefore happens
 * under an exclusive lock on a dedicated lock file, and the read-modify-write
 * cycle never spans two lock acquisitions.
 *
 * A database would be a better fit at scale; this keeps cPanel shared hosting
 * deployable with zero setup.
 */

declare(strict_types=1);

require_once __DIR__ . '/store.php';

/** Directory holding one JSON file per product. */
function inventory_dir(array $config): string
{
    $dir = store_data_dir($config) . '/inventory';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

function inventory_product_path(array $config, string $productId): string
{
    return inventory_dir($config) . '/' . store_safe_key($productId) . '.json';
}

function inventory_lock_path(array $config, string $productId): string
{
    return inventory_dir($config) . '/' . store_safe_key($productId) . '.lock';
}

/** Runs $work while holding an exclusive lock for a product. */
function inventory_with_lock(array $config, string $productId, callable $work)
{
    $lockPath = inventory_lock_path($config, $productId);
    $handle = @fopen($lockPath, 'c');
    if ($handle === false) {
        throw new RuntimeException('Could not open inventory lock file.');
    }

    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        throw new RuntimeException('Could not acquire inventory lock.');
    }

    try {
        return $work();
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

/** Reads a product's inventory without locking (safe for counts). */
function inventory_read(array $config, string $productId): array
{
    $path = inventory_product_path($config, $productId);
    if (!is_file($path)) {
        return ['product_id' => $productId, 'items' => []];
    }
    $raw = @file_get_contents($path);
    $decoded = $raw === false ? null : json_decode($raw, true);
    if (!is_array($decoded) || !isset($decoded['items']) || !is_array($decoded['items'])) {
        return ['product_id' => $productId, 'items' => []];
    }
    return $decoded;
}

/** Writes a product's inventory atomically. Caller must hold the lock. */
function inventory_write(array $config, string $productId, array $data): bool
{
    $data['product_id'] = $productId;
    $data['updated_at'] = gmdate('c');

    $path = inventory_product_path($config, $productId);
    $tmp = $path . '.' . getmypid() . '.tmp';
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return false;
    }
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        return false;
    }
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    @chmod($path, 0640);
    return true;
}

/**
 * Accepts a value as an embeddable link, or returns "".
 *
 * Inbox links are rendered in an iframe and used as an href, so anything that
 * is not plain http(s) — `javascript:`, `data:`, a broken paste — is dropped at
 * ingest rather than being stored and worrying about later.
 */
function inventory_sanitize_url($value): string
{
    $url = is_string($value) ? trim($value) : '';
    if ($url === '' || strlen($url) > 800) {
        return '';
    }
    if (!preg_match('#^https?://[^\s<>"]+$#i', $url)) {
        return '';
    }
    return $url;
}

/**
 * True when a number looks like a local-only format.
 *
 * "0712345678" is ambiguous — it is a valid pattern in Kenya, the UK and
 * elsewhere — so the country cannot be inferred. These are still accepted (the
 * admin may know better) but surfaced for review rather than silently shipped.
 */
function inventory_phone_needs_review(string $phone): bool
{
    return str_starts_with($phone, '+0');
}

/** Normalises a phone number to +<digits>. */
function inventory_normalize_phone($value): string
{
    $digits = preg_replace('/[^\d+]/', '', is_string($value) ? $value : '') ?? '';
    $digits = ltrim($digits, '+');
    if ($digits === '') {
        return '';
    }
    return '+' . $digits;
}

/**
 * Parses pasted stock lines into units.
 *
 * Credentials (`$kind = "credentials"`), one per line:
 *   UID|Password|Email
 *   UID|Password
 *   host:port:user:pass         <- proxies
 *   anything else               <- stored verbatim, UID generated
 *
 * SMS (`$kind = "sms"`), one per line:
 *   PHONE_NUMBER | INBOX_URL_OR_NOTES
 *   PHONE_NUMBER
 * Field two is treated as an inbox link when it looks like one, and as a note
 * otherwise — so an admin can paste either without getting it wrong.
 *
 * Blank lines and `#` comments are ignored. Duplicate lines within one batch
 * are dropped so a double paste does not create phantom stock.
 */
function inventory_parse_lines(string $text, string $kind = 'credentials'): array
{
    $units = [];
    $seen = [];

    $lines = preg_split('/\r\n|\r|\n/', $text) ?: [];
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (isset($seen[$line])) {
            continue;
        }
        $seen[$line] = true;

        $fields = [];
        if (str_contains($line, '|')) {
            $fields = array_map('trim', explode('|', $line));
        } elseif ($kind === 'sms') {
            // A bare line is a phone number with no inbox link yet.
            $fields = [$line];
        } elseif (substr_count($line, ':') >= 2 && !str_contains($line, ' ')) {
            // host:port:user:pass
            $fields = array_map('trim', explode(':', $line));
        }

        if ($kind === 'sms') {
            $phone = inventory_normalize_phone($fields[0] ?? '');
            if ($phone === '') {
                continue;
            }
            $second = $fields[1] ?? '';
            $inboxUrl = inventory_sanitize_url($second);

            $units[] = [
                'id' => bin2hex(random_bytes(8)),
                'kind' => 'sms',
                'uid' => $phone,
                'phone' => $phone,
                'inbox_url' => $inboxUrl,
                // Anything that is not a usable link is kept as a plain note.
                'notes' => $inboxUrl === '' ? substr($second, 0, 300) : '',
                'secret' => $line,
                'fields' => array_slice($fields, 0, 4),
                'status' => 'available',
                'order_id' => null,
                'added_at' => gmdate('c'),
                'sold_at' => null,
            ];
            continue;
        }

        $uid = $fields[0] ?? '';
        if ($uid === '') {
            $uid = 'UNIT-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
        }

        $units[] = [
            'id' => bin2hex(random_bytes(8)),
            'kind' => 'credentials',
            'uid' => substr($uid, 0, 120),
            'secret' => $line,
            'fields' => array_slice($fields, 0, 6),
            'status' => 'available',
            'order_id' => null,
            'added_at' => gmdate('c'),
            'sold_at' => null,
        ];
    }

    return $units;
}

/**
 * Appends parsed units to a product's stock as `available`.
 *
 * @return array{added:int, duplicates:int, available:int}
 */
function inventory_add_units(array $config, string $productId, string $text, string $kind = 'credentials'): array
{
    $units = inventory_parse_lines($text, $kind);
    if (!$units) {
        return ['added' => 0, 'duplicates' => 0, 'available' => inventory_count_available($config, $productId)];
    }

    return inventory_with_lock($config, $productId, function () use ($config, $productId, $units) {
        $data = inventory_read($config, $productId);

        // Skip anything already in the queue, whatever its status.
        $existing = [];
        foreach ($data['items'] as $item) {
            if (isset($item['secret'])) {
                $existing[$item['secret']] = true;
            }
        }

        $added = 0;
        $duplicates = 0;
        foreach ($units as $unit) {
            if (isset($existing[$unit['secret']])) {
                $duplicates++;
                continue;
            }
            $existing[$unit['secret']] = true;
            $data['items'][] = $unit;
            $added++;
        }

        inventory_write($config, $productId, $data);

        return [
            'added' => $added,
            'duplicates' => $duplicates,
            'available' => inventory_count_available_locked($data),
        ];
    });
}

function inventory_count_available_locked(array $data): int
{
    $n = 0;
    foreach ($data['items'] as $item) {
        if (($item['status'] ?? '') === 'available') {
            $n++;
        }
    }
    return $n;
}

/** Public stock count for one product. */
function inventory_count_available(array $config, string $productId): int
{
    return inventory_count_available_locked(inventory_read($config, $productId));
}

/** Available counts for every product that has inventory. */
function inventory_counts(array $config): array
{
    $counts = [];
    $dir = inventory_dir($config);
    foreach (glob($dir . '/*.json') ?: [] as $file) {
        $raw = @file_get_contents($file);
        $data = $raw === false ? null : json_decode($raw, true);
        if (!is_array($data) || empty($data['product_id'])) {
            continue;
        }
        $counts[(string) $data['product_id']] = inventory_count_available_locked($data);
    }
    ksort($counts);
    return $counts;
}

/**
 * Atomically claims up to $qty available units for an order.
 *
 * If fewer units are available than requested, it claims what exists and
 * reports the shortfall rather than failing outright — the buyer gets what the
 * store actually has, and the shortfall is recorded for the admin.
 *
 * @return array{units:array, shortfall:int}
 */
function inventory_claim(array $config, string $productId, int $qty, string $orderId): array
{
    if ($qty < 1) {
        return ['units' => [], 'shortfall' => 0];
    }

    return inventory_with_lock($config, $productId, function () use ($config, $productId, $qty, $orderId) {
        $data = inventory_read($config, $productId);
        $claimed = [];
        $now = gmdate('c');

        foreach ($data['items'] as $index => $item) {
            if (count($claimed) >= $qty) {
                break;
            }
            if (($item['status'] ?? '') !== 'available') {
                continue;
            }
            $data['items'][$index]['status'] = 'sold';
            $data['items'][$index]['order_id'] = $orderId;
            $data['items'][$index]['sold_at'] = $now;

            // Return the whole unit, not a narrowed copy — SMS units carry
            // phone/inbox_url/notes that fulfilment needs.
            $claimed[] = array_merge($item, [
                'id' => $item['id'] ?? '',
                'uid' => $item['uid'] ?? '',
                'secret' => $item['secret'] ?? '',
                'kind' => $item['kind'] ?? 'credentials',
            ]);
        }

        if ($claimed) {
            inventory_write($config, $productId, $data);
        }

        return [
            'units' => $claimed,
            'shortfall' => max(0, $qty - count($claimed)),
        ];
    });
}

/** Units already bound to an order (used to re-show deliverables). */
function inventory_for_order(array $config, string $orderId, ?string $productId = null): array
{
    $units = [];
    $dir = inventory_dir($config);
    $products = $productId !== null
        ? [$productId]
        : array_map(
            static fn ($f) => basename((string) $f, '.json'),
            glob($dir . '/*.json') ?: []
        );

    foreach ($products as $pid) {
        foreach (inventory_read($config, $pid)['items'] as $item) {
            if (($item['order_id'] ?? null) === $orderId && ($item['status'] ?? '') === 'sold') {
                $units[] = [
                    'product_id' => $pid,
                    'uid' => $item['uid'] ?? '',
                    'secret' => $item['secret'] ?? '',
                    'id' => $item['id'] ?? '',
                ];
            }
        }
    }

    return $units;
}

/** Removes a unit from the queue by its internal id. */
function inventory_delete_unit(array $config, string $productId, string $unitId): bool
{
    return inventory_with_lock($config, $productId, function () use ($config, $productId, $unitId) {
        $data = inventory_read($config, $productId);
        $before = count($data['items']);
        $data['items'] = array_values(array_filter(
            $data['items'],
            static fn ($i) => ($i['id'] ?? '') !== $unitId
        ));
        if (count($data['items']) === $before) {
            return false;
        }
        inventory_write($config, $productId, $data);
        return true;
    });
}

/** Admin overview: per-product totals plus a sample of available units. */
function inventory_summary(array $config, int $sampleSize = 5): array
{
    $rows = [];
    foreach (glob(inventory_dir($config) . '/*.json') ?: [] as $file) {
        $raw = @file_get_contents($file);
        $data = $raw === false ? null : json_decode($raw, true);
        if (!is_array($data) || empty($data['product_id'])) {
            continue;
        }

        $available = 0;
        $sold = 0;
        $sample = [];
        foreach ($data['items'] as $item) {
            if (($item['status'] ?? '') === 'available') {
                $available++;
                if (count($sample) < $sampleSize) {
                    $sample[] = ['uid' => $item['uid'] ?? '', 'secret' => $item['secret'] ?? ''];
                }
            } elseif (($item['status'] ?? '') === 'sold') {
                $sold++;
            }
        }

        $rows[] = [
            'product_id' => (string) $data['product_id'],
            'available' => $available,
            'sold' => $sold,
            'total' => $available + $sold,
            'sample' => $sample,
            'updated_at' => $data['updated_at'] ?? null,
        ];
    }

    usort($rows, static fn ($a, $b) => strcmp($a['product_id'], $b['product_id']));
    return $rows;
}
