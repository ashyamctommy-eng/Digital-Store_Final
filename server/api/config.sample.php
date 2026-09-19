<?php
/**
 * Payment API configuration.
 *
 * THIS FILE MUST NOT BE COMMITTED WITH REAL KEYS.
 *
 * Copy it to `config.php` on the server and fill in the live values:
 *     cp config.sample.php config.php
 *
 * `config.php` is git-ignored and blocked from HTTP access by .htaccess.
 */

return [
    // ---------------------------------------------------------------
    // Environment: 'sandbox' or 'live'
    // ---------------------------------------------------------------
    'mode' => 'sandbox',

    // ---------------------------------------------------------------
    // Palplus — M-Pesa STK push (KES)
    // Console: https://console.palpluss.com  → Settings → API Keys
    // Keys start with pk_test_ (sandbox) or pk_live_ (live).
    // ---------------------------------------------------------------
    'palplus' => [
        'api_key' => '',
        'sandbox_base' => 'https://sandbox.palpluss.com/v1',
        'live_base' => 'https://api.palpluss.com/v1',
        // Your payment channel UUID (console → Payment Channels). Leave empty
        // to use the account default. Required in practice: without a default
        // channel Palplus returns 400 NO_DEFAULT_CHANNEL.
        'channel_id' => '',
        // 'basic' = Authorization: Basic base64("<key>:")  (documented default)
        // 'raw'   = Authorization: Basic <key>
        'auth_style' => 'basic',
    ],

    // ---------------------------------------------------------------
    // NOWPayments — crypto invoices (USD)
    // Dashboard: https://account.nowpayments.io  → Settings → API keys
    // The IPN secret comes from Settings → Payment settings → IPN.
    // ---------------------------------------------------------------
    'nowpayments' => [
        'api_key' => '',
        'ipn_secret' => '',
        'api_base' => 'https://api.nowpayments.io/v1',
    ],

    // ---------------------------------------------------------------
    // Resend — transactional email for credential delivery
    // Dashboard: https://resend.com/api-keys  (key starts with re_)
    // `from` must be a domain you have verified in Resend.
    // ---------------------------------------------------------------
    'resend' => [
        'api_key' => '',
        'from' => 'Digital Hub Shop <orders@your-domain.example>',
        'reply_to' => '',
        'enabled' => true,
    ],

    // ---------------------------------------------------------------
    // Admin API
    // Shared secret for the admin-only inventory endpoints. Generate one with:
    //   php -r "echo bin2hex(random_bytes(24));"
    // Enter it once in the admin UI; it is stored per browser session.
    // ---------------------------------------------------------------
    'admin_api_key' => '',

    // ---------------------------------------------------------------
    // Operational settings
    // ---------------------------------------------------------------
    // Shown in emails and order exports.
    'store_name' => 'Digital Hub Shop',

    // When true, product stock on the storefront is driven by
    // COUNT(available inventory) instead of the static catalog number.
    'inventory_drives_stock' => true,

    // Public HTTPS base URL of this site, used for callback URLs.
    // Palplus rejects localhost and private addresses.
    'public_base_url' => 'https://your-domain.example',

    // Where the order ledger is written. Keep it outside the web root if your
    // host allows it; otherwise the bundled .htaccess blocks HTTP access.
    'data_dir' => __DIR__ . '/data',

    // Refuse to start a payment if a matching order was never recorded.
    'require_known_order' => true,

    // Upper bound on a single KES charge, as a sanity guard (0 = no limit).
    'max_kes_amount' => 500000,

    // Emit permissive CORS headers on the API. Only needed if you call these
    // endpoints from a different origin; server-to-server webhooks ignore it.
    'allow_cors' => false,
];
