<?php
/**
 * POST /api/admin/nextproxy-key        (admin key required)
 *
 * Stores or clears the NextProxy API key from the admin console, so the owner
 * does not have to edit config.php on the server.
 *
 * Request  { apiKey: "nex_live_…" }      -> save
 *          { apiKey: "" }                -> clear, falling back to config.php
 *          { refresh: true }             -> re-probe and report
 * Response { saved, key_present, key_masked, key_source, status }
 *
 * The effective key resolves as: this stored value, then `nextproxy.api_key` in
 * config.php, then the NEXTPROXY_API_KEY environment variable. Clearing the
 * stored value therefore falls back rather than disabling the integration.
 *
 * Only `nextproxy.api_key` can be written through here — the settings store
 * rejects anything else by design. The key itself is never echoed back; the
 * response carries a masked form only.
 *
 * Note that a key is optional for this provider: its pool is served publicly,
 * so an empty key still works. A key is validated when supplied, though, and a
 * wrong one fails every request — which is worth knowing before blaming the
 * provider for an outage.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/settings.php';
require_once __DIR__ . '/../lib/nextproxy.php';

$config = load_config();
require_method('POST');
require_admin($config);

$body = read_json_body();

// Sanity-check the shape. The provider issues keys in the form `nex_live_…`,
// but nothing documents the format, so this only rejects obvious junk.
$error = null;
if (array_key_exists('apiKey', $body)) {
    $raw = $body['apiKey'];
    if ($raw !== null && !is_string($raw)) {
        json_error('apiKey must be a string.', 422, 'INVALID_API_KEY');
    }
    $key = trim((string) $raw);

    if ($key !== '') {
        if (strlen($key) > 200) {
            json_error('That key is too long.', 422, 'INVALID_API_KEY');
        }
        if (preg_match('/\s/', $key) === 1) {
            json_error('That key contains spaces — check the copy-paste.', 422, 'INVALID_API_KEY');
        }
        if (str_starts_with(strtolower($key), 'bearer ')) {
            json_error('Send the bare key, without a "Bearer " prefix.', 422, 'INVALID_API_KEY');
        }
    }

    $write = settings_write($config, ['nextproxy.api_key' => $key === '' ? null : $key]);
    if (!$write['ok']) {
        json_error(
            'Could not write to the settings file. Check that api/data is writable.',
            500,
            'SETTINGS_WRITE_FAILED'
        );
    }
}

// Always re-probe after a change so the console reflects reality immediately.
// The previous cached result described the old key.
$status = nextproxy_probe($config);

// Keep the cache in step with what the admin is now looking at.
$path = store_data_dir($config) . '/nextproxy-status.json';
$tmp = $path . '.tmp';
if (@file_put_contents($tmp, json_encode(
    ['at' => time(), 'status' => $status],
    JSON_UNESCAPED_SLASHES
), LOCK_EX) !== false) {
    @rename($tmp, $path);
    @chmod($path, 0o640);
}

$key = nextproxy_api_key($config);

json_ok([
    'saved' => array_key_exists('apiKey', $body),
    'key_present' => $key !== '',
    'key_masked' => settings_mask_secret($key),
    'key_source' => nextproxy_key_source($config),
    'status' => $status,
]);
