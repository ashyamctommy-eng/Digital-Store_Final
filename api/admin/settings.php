<?php
/**
 * GET  /api/admin/settings          (admin key required)
 * POST /api/admin/settings          (admin key required)
 *
 * The super-admin configuration surface.
 *
 * GET returns the whole configurable state, grouped for rendering, plus a setup
 * checklist derived from what is actually configured. Secrets come back masked —
 * there is no response from this endpoint that contains a key.
 *
 * POST accepts `{ settings: { "palplus.api_key": "pk_live_…", … } }`. Only keys
 * in settings_schema() may be written, each is validated, and the whole batch is
 * rejected if any field fails so a save can never half-apply. Sending an empty
 * string clears a value, which is how you fall back to config.php.
 *
 * `admin_api_key` is deliberately not writable here: it is the credential that
 * authorises this endpoint, and a bad save would lock the owner out of the only
 * tool that could fix it. It stays in config.php.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/settings.php';
require_once __DIR__ . '/../lib/palplus.php';
require_once __DIR__ . '/../lib/nowpayments.php';
require_once __DIR__ . '/../lib/smsotp.php';
require_once __DIR__ . '/../lib/email.php';

$config = load_config();
require_admin($config);

/**
 * What still has to be done before the store can take money.
 *
 * Derived from real state, never hard-coded, so the list cannot claim something
 * is done when it is not.
 */
function settings_checklist(array $config): array
{
    $publicBase = trim((string) config_value($config, 'public_base_url', ''));
    $items = [
        [
            'id' => 'public_base_url',
            'label' => 'Public site URL is set to HTTPS',
            'done' => $publicBase !== '' && str_starts_with($publicBase, 'https://'),
            'detail' => $publicBase === ''
                ? 'Set it in General. Callback URLs are built from it.'
                : (str_starts_with($publicBase, 'https://') ? $publicBase : 'Must start with https:// — gateways reject plain HTTP.'),
            'blocking' => true,
        ],
        [
            'id' => 'data_dir',
            'label' => 'Data directory is writable',
            'done' => (function () use ($config) {
                $dir = (string) config_value($config, 'data_dir', __DIR__ . '/../data');
                return is_dir($dir) ? is_writable($dir) : is_writable(dirname($dir));
            })(),
            'detail' => 'chmod 755 api/data and api/data/inventory, or the order ledger cannot be written.',
            'blocking' => true,
        ],
        [
            'id' => 'palplus',
            'label' => 'Palplus is configured',
            'done' => palplus_is_configured($config),
            'detail' => palplus_is_configured($config)
                ? 'Key present.'
                : 'Needed for M-Pesa. Add the API key under Palplus.',
            'blocking' => false,
        ],
        [
            'id' => 'palplus_channel',
            'label' => 'An M-Pesa payment channel is set as default',
            'done' => trim((string) config_value($config, 'palplus.channel_id', '')) !== '',
            'detail' => 'Without a default channel Palplus returns 400 NO_DEFAULT_CHANNEL and no payment can start. Set it in the Palplus console, or paste a channel ID here.',
            'blocking' => palplus_is_configured($config),
        ],
        [
            'id' => 'nowpayments',
            'label' => 'NOWPayments is configured',
            'done' => nowpayments_is_configured($config)
                && trim((string) config_value($config, 'nowpayments.ipn_secret', '')) !== '',
            'detail' => 'Needed for crypto (USD). Requires both the API key and the IPN secret — the secret is what proves a webhook really came from them.',
            'blocking' => false,
        ],
        [
            'id' => 'resend',
            'label' => 'Order email can be delivered',
            'done' => email_is_configured($config),
            'detail' => email_is_configured($config)
                ? 'Key present. Use "Test connection" to confirm the sending domain is verified.'
                : 'Optional: without it, buyers see credentials on the order page but receive no email.',
            'blocking' => false,
        ],
    ];

    $blocking = array_filter($items, static fn ($i) => $i['blocking'] && !$i['done']);
    return [
        'items' => $items,
        'ready_for_payments' => count($blocking) === 0,
        'blocking' => array_values(array_map(static fn ($i) => $i['label'], $blocking)),
    ];
}

require_method($_SERVER['REQUEST_METHOD'] === 'POST' ? 'POST' : 'GET');

if (strtoupper((string) $_SERVER['REQUEST_METHOD']) === 'POST') {
    $body = read_json_body();
    $patch = is_array($body['settings'] ?? null) ? $body['settings'] : null;

    if ($patch === null || $patch === []) {
        json_error('Send `{ "settings": { … } }` with at least one key.', 422, 'NOTHING_TO_SAVE');
    }

    $result = settings_save($config, $patch);
    if (!$result['ok']) {
        store_log($config, 'admin.settings.rejected', ['keys' => array_keys($patch)]);

        json_response([
            'error' => 'Some values were rejected. Nothing was saved.',
            'errorCode' => 'VALIDATION_FAILED',
            'fieldErrors' => $result['errors'],
        ], 422);
    }

    store_log($config, 'admin.settings.saved', [
        // Log which settings changed, never their values.
        'saved' => $result['saved'],
        'cleared' => $result['cleared'],
    ]);

    // config_value caches per request; a fresh read reflects the change at once.
    $fresh = load_config();
    config_value($fresh, '__noop__');

    json_ok([
        'saved' => $result['saved'],
        'cleared' => $result['cleared'],
        'groups' => settings_state($config),
        'checklist' => settings_checklist($config),
    ]);
}

json_ok([
    'groups' => settings_state($config),
    'checklist' => settings_checklist($config),
    'mode' => (string) config_value($config, 'mode', 'sandbox'),
    // Stated in the response so the UI never has to guess.
    'not_editable_here' => ['admin_api_key', 'data_dir'],
]);
