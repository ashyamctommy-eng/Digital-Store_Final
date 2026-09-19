<?php
/**
 * Runtime configuration that the super-admin console can edit.
 *
 * Gateway keys used to require editing `config.php` on the server over SSH or
 * the cPanel file manager. That is fine for an engineer and miserable for an
 * owner. These values are written to `data/settings.json` instead, so they can
 * be pasted into the console — while still never reaching the browser.
 *
 * Three rules keep this safe:
 *
 *   1. Only keys defined in settings_schema() can be written. There is no way
 *      to set an arbitrary key through the API, so the endpoint cannot be used
 *      to rewrite configuration it has no business touching.
 *   2. Secrets are never returned. The console receives a masked hint, whether
 *      a value is set, and where it came from — never the value itself.
 *   3. `admin_api_key` and `data_dir` are deliberately NOT in the schema. The
 *      admin key is the credential that authorises this console, so making it
 *      editable from inside the console would mean a bad save locks the owner
 *      out of the only tool that can fix it. It stays in `config.php`, which is
 *      always recoverable by hand.
 *
 * Resolution order for every writable key is: settings.json, then config.php,
 * then the built-in default. `config_value()` applies that everywhere, so no
 * gateway client had to be changed to pick these up.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';

/**
 * Every configurable key: how it is labelled, validated and rendered.
 *
 * The console renders itself from this, so there is exactly one definition of
 * what is configurable — no PHP/TypeScript pair to drift apart.
 */
function settings_schema(): array
{
    return [
        // ------------------------------------------------------ general
        'mode' => [
            'group' => 'general',
            'label' => 'Environment',
            'type' => 'select',
            'options' => ['sandbox', 'live'],
            'default' => 'sandbox',
            'hint' => 'Sandbox uses the test gateways. Switch to live only once a real transaction has succeeded.',
        ],
        'store_name' => [
            'group' => 'general',
            'label' => 'Store name',
            'type' => 'text',
            'default' => 'Digital Hub Shop',
            'hint' => 'Shown in emails and on order exports.',
        ],
        'public_base_url' => [
            'group' => 'general',
            'label' => 'Public site URL',
            'type' => 'url',
            'default' => '',
            'validate' => 'https_url',
            'hint' => 'Must be the HTTPS address of this site. Gateways refuse localhost and plain HTTP, and it is what the callback URLs are built from.',
            // Shown as required in the checklist; still clearable here so it can
            // fall back to config.php.
            'required' => true,
        ],

        // ------------------------------------------------------ palplus
        'palplus.api_key' => [
            'group' => 'palplus',
            'label' => 'API key',
            'type' => 'secret',
            'validate' => 'palplus_key',
            'placeholder' => 'pk_live_…',
            'hint' => 'Console → Settings → API Keys. Starts with pk_live_ or pk_test_. Shown once at creation, so keep a copy.',
        ],
        'palplus.channel_id' => [
            'group' => 'palplus',
            'label' => 'Payment channel ID',
            'type' => 'text',
            'placeholder' => 'optional',
            'hint' => 'Console → Payment Channels. Every STK push routes through a channel (the M-Pesa shortcode). Leave empty to use your default channel, but set one as default or payments fail with NO_DEFAULT_CHANNEL.',
        ],
        'palplus.auth_style' => [
            'group' => 'palplus',
            'label' => 'Authorization style',
            'type' => 'select',
            'options' => ['basic', 'raw'],
            'default' => 'basic',
            'advanced' => true,
            'hint' => 'Documented behaviour is basic: the key is the username with an empty password, i.e. base64("<key>:"). Change only if a proxy is rewriting the header.',
        ],
        'palplus.live_base' => [
            'group' => 'palplus',
            'label' => 'Live base URL',
            'type' => 'url',
            'default' => 'https://api.palpluss.com/v1',
            'validate' => 'https_url',
            'advanced' => true,
        ],
        'palplus.sandbox_base' => [
            'group' => 'palplus',
            'label' => 'Sandbox base URL',
            'type' => 'url',
            'default' => 'https://sandbox.palpluss.com/v1',
            'validate' => 'https_url',
            'advanced' => true,
        ],
        'max_kes_amount' => [
            'group' => 'palplus',
            'label' => 'Maximum single M-Pesa charge (KES)',
            'type' => 'number',
            'default' => 500000,
            'validate' => 'non_negative_int',
            'hint' => 'Sanity guard. 0 disables it.',
            'advanced' => true,
        ],

        // -------------------------------------------------- nowpayments
        'nowpayments.api_key' => [
            'group' => 'nowpayments',
            'label' => 'API key',
            'type' => 'secret',
            'hint' => 'Dashboard → Settings → API keys.',
        ],
        'nowpayments.ipn_secret' => [
            'group' => 'nowpayments',
            'label' => 'IPN secret',
            'type' => 'secret',
            'hint' => 'Dashboard → Settings → Payment settings → IPN. Used to verify that a webhook really came from NOWPayments.',
        ],
        'nowpayments.api_base' => [
            'group' => 'nowpayments',
            'label' => 'API base URL',
            'type' => 'url',
            'default' => 'https://api.nowpayments.io/v1',
            'validate' => 'https_url',
            'advanced' => true,
        ],

        // ------------------------------------------------------- resend
        'resend.api_key' => [
            'group' => 'resend',
            'label' => 'API key',
            'type' => 'secret',
            'placeholder' => 're_…',
            'hint' => 'resend.com/api-keys. Starts with re_.',
        ],
        'resend.from' => [
            'group' => 'resend',
            'label' => 'From address',
            'type' => 'text',
            'placeholder' => 'Digital Hub Shop <orders@your-domain>',
            'hint' => 'The domain must be verified in Resend or delivery silently fails.',
        ],
        'resend.reply_to' => [
            'group' => 'resend',
            'label' => 'Reply-to (optional)',
            'type' => 'text',
            'advanced' => true,
        ],
        'resend.enabled' => [
            'group' => 'resend',
            'label' => 'Email delivery',
            'type' => 'bool',
            'default' => true,
            'hint' => 'Turn off to stop order emails without clearing the key.',
        ],

        // ------------------------------------------------------- smsotp
        'smsotp.api_key' => [
            'group' => 'smsotp',
            'label' => 'API key',
            'type' => 'secret',
            'hint' => 'smsotp.net profile → API key. Optional: without it, SMS products are limited to numbers you upload yourself.',
        ],
        'smsotp.api_base' => [
            'group' => 'smsotp',
            'label' => 'API base URL',
            'type' => 'url',
            'default' => 'https://smsotp.net/api/v1',
            'validate' => 'https_url',
            'advanced' => true,
        ],
        'smsotp.min_balance' => [
            'group' => 'smsotp',
            'label' => 'Minimum balance to buy on demand',
            'type' => 'number',
            'default' => 0.01,
            'validate' => 'non_negative_number',
            'hint' => 'Numbers are only bought on demand when the balance is above this.',
        ],

        // ---------------------------------------------------- proxycheck
        'proxycheck.echo_url' => [
            'group' => 'proxycheck',
            'label' => 'Reflector URL',
            'type' => 'url',
            'default' => '',
            'validate' => 'optional_http_url',
            'hint' => 'Leave empty in production: it defaults to {public site URL}/api/proxies/echo. Set it only if the server cannot reach its own public address.',
        ],
        'proxycheck.timeout_seconds' => [
            'group' => 'proxycheck',
            'label' => 'Per-address timeout (seconds)',
            'type' => 'number',
            'default' => 8,
            'validate' => 'positive_int',
            'advanced' => true,
        ],
        'proxycheck.concurrency' => [
            'group' => 'proxycheck',
            'label' => 'Addresses tested at once',
            'type' => 'number',
            'default' => 10,
            'validate' => 'positive_int',
            'advanced' => true,
        ],
        'proxycheck.allow_private' => [
            'group' => 'proxycheck',
            'label' => 'Allow testing private addresses',
            'type' => 'bool',
            'default' => false,
            'hint' => 'Lets the checker probe a proxy on your own network. Uploads always reject private addresses, so this cannot be used to sell them.',
            'advanced' => true,
        ],

        // ----------------------------------------------------- advanced
        'inventory_drives_stock' => [
            'group' => 'advanced',
            'label' => 'Stock counts come from the credential queue',
            'type' => 'bool',
            'default' => true,
            'hint' => 'When on, the storefront shows live COUNT(available) instead of the catalog number. Turning it off can oversell.',
            'advanced' => true,
        ],
        'require_known_order' => [
            'group' => 'advanced',
            'label' => 'Refuse payments for unknown orders',
            'type' => 'bool',
            'default' => true,
            'advanced' => true,
        ],
        'max_inventory_lines' => [
            'group' => 'advanced',
            'label' => 'Maximum stock lines per upload',
            'type' => 'number',
            'default' => 5000,
            'validate' => 'positive_int',
            'advanced' => true,
        ],
        'allow_cors' => [
            'group' => 'advanced',
            'label' => 'Send permissive CORS headers',
            'type' => 'bool',
            'default' => false,
            'hint' => 'Only needed if the storefront is served from a different origin to the API.',
            'advanced' => true,
        ],
    ];
}

/** Groups, in the order the console shows them. */
function settings_groups(): array
{
    return [
        'general' => ['label' => 'General', 'blurb' => 'Where the store lives and which environment it talks to.'],
        'palplus' => ['label' => 'Palplus (M-Pesa)', 'blurb' => 'Settles KES payments.'],
        'nowpayments' => ['label' => 'NOWPayments (crypto)', 'blurb' => 'Settles USD payments.'],
        'resend' => ['label' => 'Resend (order email)', 'blurb' => 'Delivers purchased credentials by email.'],
        'smsotp' => ['label' => 'SMS provider', 'blurb' => 'Supplies phone numbers on demand when your own stock runs out.'],
        'proxycheck' => ['label' => 'Proxy checker', 'blurb' => 'Tests uploaded proxy addresses before they are sold.'],
        'advanced' => ['label' => 'Advanced', 'blurb' => 'Change these only if you know why.'],
    ];
}

/**
 * Where settings.json lives.
 *
 * Resolved from `config.php` directly rather than through `store_data_dir()`,
 * because `data_dir` is deliberately not console-editable and going through the
 * settings-aware reader here would be circular.
 */
function settings_data_dir(array $config): string
{
    $dir = $config['data_dir'] ?? (__DIR__ . '/../data');
    $dir = is_string($dir) && $dir !== '' ? $dir : (__DIR__ . '/../data');
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

function settings_path(array $config): string
{
    return settings_data_dir($config) . '/settings.json';
}

/** Reads settings.json once per request. */
function settings_saved(array $config, bool $fresh = false): array
{
    static $cache = null;
    if ($fresh) {
        $cache = null;
    }
    if ($cache !== null) {
        return $cache;
    }

    $path = settings_path($config);
    if (!is_file($path)) {
        return $cache = [];
    }
    $raw = @file_get_contents($path);
    if ($raw === false) {
        return $cache = [];
    }
    $decoded = json_decode($raw, true);
    return $cache = is_array($decoded) ? $decoded : [];
}

/** A saved value, or null when this key has never been set from the console. */
function settings_get(array $config, string $key, $default = null)
{
    $saved = settings_saved($config);
    if (!array_key_exists($key, $saved)) {
        return $default;
    }
    return $saved[$key];
}

/** Where the value in force came from — the console, config.php, or nowhere. */
function settings_source(array $config, string $key): string
{
    $saved = settings_saved($config);
    if (array_key_exists($key, $saved) && $saved[$key] !== '' && $saved[$key] !== null) {
        return 'console';
    }

    $node = $config;
    foreach (explode('.', $key) as $segment) {
        if (!is_array($node) || !array_key_exists($segment, $node)) {
            return 'unset';
        }
        $node = $node[$segment];
    }

    if (is_bool($node)) {
        return 'config';
    }
    return ($node !== null && $node !== '') ? 'config' : 'unset';
}

/* -------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------- */

/** Per-rule validators. Each returns null when acceptable, or a message. */
function settings_validate_value(string $rule, $value): ?string
{
    $text = is_string($value) ? trim($value) : (string) $value;

    switch ($rule) {
        case 'https_url':
            if ($text === '') {
                return null;
            }
            if (!preg_match('#^https://#i', $text)) {
                return 'Must start with https:// — gateways reject plain HTTP and localhost.';
            }
            if (!filter_var($text, FILTER_VALIDATE_URL)) {
                return 'That does not look like a URL.';
            }
            return null;

        case 'optional_http_url':
            if ($text === '') {
                return null;
            }
            if (!preg_match('#^https?://#i', $text) || !filter_var($text, FILTER_VALIDATE_URL)) {
                return 'Must be a full http:// or https:// URL, or left empty.';
            }
            return null;

        case 'palplus_key':
            if ($text === '') {
                return null;
            }
            if (!preg_match('/^pk_(live|test)_[A-Za-z0-9]+$/', $text)) {
                return 'Palplus keys look like pk_live_… or pk_test_…. Check for a truncated paste.';
            }
            return null;

        case 'non_negative_int':
            if (!is_numeric($text) || (int) $text < 0) {
                return 'Must be a whole number, 0 or more.';
            }
            return null;

        case 'positive_int':
            if (!is_numeric($text) || (int) $text < 1) {
                return 'Must be a whole number, 1 or more.';
            }
            return null;

        case 'non_negative_number':
            if (!is_numeric($text) || (float) $text < 0) {
                return 'Must be a number, 0 or more.';
            }
            return null;
    }

    return null;
}

/**
 * Normalises a submitted value for storage.
 *
 * `bool` and `number` arrive from a browser as strings, and a gateway key
 * copy-pasted with a newline would fail in a way that looks like a provider
 * outage, so everything is trimmed.
 */
function settings_normalize(string $type, $value)
{
    if ($type === 'bool') {
        return $value === true || $value === 'true' || $value === '1' || $value === 1;
    }
    if (!is_scalar($value)) {
        return '';
    }
    $text = trim((string) $value);
    if ($type === 'number') {
        return is_numeric($text) ? $text + 0 : $text;
    }
    return $text;
}

/* -------------------------------------------------------------------------
 * Writing
 * ---------------------------------------------------------------------- */

/**
 * Validates and writes a batch of settings.
 *
 * @return array{ok:bool, saved:list<string>, cleared:list<string>, errors:array<string,string>}
 */
function settings_save(array $config, array $patch): array
{
    $schema = settings_schema();
    $saved = [];
    $cleared = [];
    $errors = [];

    // Validate everything before writing anything: a half-applied batch would
    // leave the store in a state nobody asked for.
    $pending = [];
    foreach ($patch as $key => $value) {
        $key = (string) $key;
        if (!isset($schema[$key])) {
            $errors[$key] = 'That setting cannot be changed from here.';
            continue;
        }

        $type = $schema[$key]['type'];
        $normalized = settings_normalize($type, $value);

        if (isset($schema[$key]['validate'])) {
            $message = settings_validate_value($schema[$key]['validate'], $normalized);
            if ($message !== null) {
                $errors[$key] = $message;
                continue;
            }
        }
        if ($type === 'select' && !in_array($normalized, $schema[$key]['options'] ?? [], true)) {
            $errors[$key] = 'Not one of the allowed values.';
            continue;
        }
        // `required` is deliberately NOT enforced here. Emptying a field is the
        // supported way to fall back to config.php, and blocking it would trap
        // an owner who pasted a wrong value. Whether a required setting is
        // actually present is a readiness question, answered by the checklist in
        // admin/settings.php.

        $pending[$key] = $normalized;
    }

    if ($errors) {
        return ['ok' => false, 'saved' => [], 'cleared' => [], 'errors' => $errors];
    }

    $all = settings_saved($config);
    foreach ($pending as $key => $value) {
        // Empty means "fall back to config.php or the default", which is how a
        // value is removed without editing files on the server.
        if ($value === '' || $value === null) {
            unset($all[$key]);
            $cleared[] = $key;
        } else {
            $all[$key] = $value;
            $saved[] = $key;
        }
    }

    $path = settings_path($config);
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        return ['ok' => false, 'saved' => [], 'cleared' => [], 'errors' => ['_' => 'Could not create the data directory.']];
    }

    $encoded = json_encode($all, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) {
        return ['ok' => false, 'saved' => [], 'cleared' => [], 'errors' => ['_' => 'Could not encode the settings.']];
    }

    $tmp = $path . '.tmp';
    if (@file_put_contents($tmp, $encoded, LOCK_EX) === false) {
        return ['ok' => false, 'saved' => [], 'cleared' => [], 'errors' => ['_' => 'The data directory is not writable.']];
    }

    // This file holds gateway keys: owner-only, never world-readable.
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return ['ok' => false, 'saved' => [], 'cleared' => [], 'errors' => ['_' => 'Could not write the settings file.']];
    }
    @chmod($path, 0600);

    // Both caches must drop: settings_saved() holds this file, and
    // config_console_overrides() holds the copy config_value() reads. Without
    // the second, the caller would still see the pre-save value.
    settings_saved($config, true);
    config_forget_overrides();

    return ['ok' => true, 'saved' => $saved, 'cleared' => $cleared, 'errors' => []];
}

/* -------------------------------------------------------------------------
 * Presentation
 * ---------------------------------------------------------------------- */

/** Masks a secret: enough to recognise which key it is, not enough to use it. */
function settings_mask(?string $value): string
{
    $value = trim((string) $value);
    $length = strlen($value);
    if ($length === 0) {
        return '';
    }
    if ($length <= 8) {
        return str_repeat('•', $length);
    }
    return substr($value, 0, 4) . str_repeat('•', 6) . substr($value, -4);
}

/**
 * The whole configuration state, ready for the console.
 *
 * Secrets are masked and there is no path that returns one — a saved key is
 * never sent back, only the fact that it is set and where it came from.
 */
function settings_state(array $config): array
{
    $schema = settings_schema();
    $groups = [];

    foreach (settings_groups() as $groupId => $meta) {
        $fields = [];
        foreach ($schema as $key => $field) {
            if ($field['group'] !== $groupId) {
                continue;
            }

            $value = config_value($config, $key, $field['default'] ?? '');
            $isSecret = $field['type'] === 'secret';
            $hasValue = $value !== '' && $value !== null;

            $fields[] = [
                'key' => $key,
                'label' => $field['label'],
                'type' => $field['type'],
                'hint' => $field['hint'] ?? null,
                'placeholder' => $field['placeholder'] ?? null,
                'options' => $field['options'] ?? null,
                'advanced' => !empty($field['advanced']),
                'required' => !empty($field['required']),
                'is_secret' => $isSecret,
                'is_set' => $hasValue,
                'source' => settings_source($config, $key),
                // The value for non-secrets; a masked hint for secrets.
                'value' => $isSecret
                    ? ''
                    : (is_bool($value) ? $value : (string) $value),
                'masked' => $isSecret && $hasValue ? settings_mask(is_string($value) ? $value : '') : '',
            ];
        }

        $groups[] = [
            'id' => $groupId,
            'label' => $meta['label'],
            'blurb' => $meta['blurb'],
            'fields' => $fields,
        ];
    }

    return $groups;
}
