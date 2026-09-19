<?php
/**
 * Runtime settings written from the admin console.
 *
 * Some integrations need a key the admin can paste into the UI rather than
 * edit into config.php on the server (which may not be writable, and which a
 * non-technical owner should not have to touch). Those values live in
 * `data/settings.json`, next to the order ledger.
 *
 * Two rules keep this safe:
 *
 *   1. Only keys in SETTINGS_WRITABLE can be written. The admin UI cannot
 *      overwrite arbitrary configuration through this path.
 *   2. Nothing here is ever returned to the browser verbatim — the admin
 *      endpoints report a masked value and the source it came from.
 *
 * Resolution order for a value is: settings.json, then config.php, then the
 * environment. config.php therefore still wins for anyone who prefers
 * file-based deployment, and the UI value can be cleared to fall back to it.
 */

declare(strict_types=1);

require_once __DIR__ . '/store.php';

/** Settings an admin may write through the API. Anything else is rejected. */
const SETTINGS_WRITABLE = [
    'nextproxy.api_key',
];

function settings_path(array $config): string
{
    return store_data_dir($config) . '/settings.json';
}

/** Reads the whole settings file. Returns [] when absent or unreadable. */
function settings_read(array $config): array
{
    $path = settings_path($config);
    if (!is_file($path)) {
        return [];
    }
    $raw = @file_get_contents($path);
    if ($raw === false) {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/** Reads one setting, or $default when it has never been written. */
function settings_get(array $config, string $key, $default = null)
{
    $all = settings_read($config);
    return array_key_exists($key, $all) ? $all[$key] : $default;
}

/**
 * Writes settings, ignoring keys that are not writable.
 *
 * A null value deletes the key, which is how the admin clears a stored key and
 * falls back to config.php.
 *
 * @return array{ok:bool, written:array, rejected:array}
 */
function settings_write(array $config, array $patch): array
{
    $all = settings_read($config);
    $written = [];
    $rejected = [];

    foreach ($patch as $key => $value) {
        if (!in_array($key, SETTINGS_WRITABLE, true)) {
            $rejected[] = (string) $key;
            continue;
        }
        if ($value === null || $value === '') {
            unset($all[$key]);
        } else {
            // Settings here are keys and identifiers, never nested structures.
            $all[$key] = is_scalar($value) ? (string) $value : '';
            if ($all[$key] === '') {
                unset($all[$key]);
            }
        }
        $written[] = (string) $key;
    }

    $path = settings_path($config);
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        return ['ok' => false, 'written' => [], 'rejected' => $rejected];
    }

    $tmp = $path . '.tmp';
    $encoded = json_encode($all, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) {
        return ['ok' => false, 'written' => [], 'rejected' => $rejected];
    }
    if (@file_put_contents($tmp, $encoded, LOCK_EX) === false) {
        return ['ok' => false, 'written' => [], 'rejected' => $rejected];
    }

    // The file holds API keys: owner-only, and never world-readable.
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return ['ok' => false, 'written' => [], 'rejected' => $rejected];
    }
    @chmod($path, 0600);

    return ['ok' => true, 'written' => $written, 'rejected' => $rejected];
}

/**
 * Masks a secret for display: enough to recognise which key it is, not enough
 * to use it. Short values are hidden entirely.
 */
function settings_mask_secret(string $value): string
{
    $value = trim($value);
    $length = strlen($value);
    if ($length === 0) {
        return '';
    }
    if ($length <= 8) {
        return str_repeat('•', $length);
    }
    return substr($value, 0, 4) . str_repeat('•', 6) . substr($value, -4);
}
