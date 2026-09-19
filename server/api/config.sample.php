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

/**
 * BOOTSTRAP CONFIGURATION ONLY.
 *
 * Most settings — every gateway key, email, provider limits — are managed in the
 * super-admin console under **Configurations**, and stored in
 * `api/data/settings.json`. Values saved there take precedence over this file,
 * so you only need to edit this file by hand for the two things the console
 * deliberately will not touch:
 *
 *   admin_api_key   the credential that authorises the console. Making it
 *                   editable from inside the console would mean a bad save locks
 *                   you out of the only tool that could fix it.
 *   data_dir        where the ledger and settings live. Moving it from the
 *                   console would move the file the console is reading.
 *
 * Everything else below is a default or a fallback. Once the console has a
 * value, it wins, and clearing it in the console falls back to whatever is here.
 */

return [
    // ---------------------------------------------------------------
    // Environment: 'sandbox' or 'live'
    // Console equivalent: General → Environment
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
    // smsotp.net — on-demand SMS activations (hybrid SMS delivery)
    // Dashboard: https://smsotp.net/profile  → API key
    //
    // Used ONLY as a fallback: pre-bought static stock is always tried first,
    // and an activation is bought only when that stock is empty. Each
    // activation spends real balance, and only ever after the order is paid.
    // ---------------------------------------------------------------
    'smsotp' => [
        'api_key' => '',
        'api_base' => 'https://smsotp.net/api/v1',
        // Skip on-demand buying unless the balance is above this, so a nearly
        // empty balance cannot produce half-fulfilled orders.
        'min_balance' => 0.01,
        // How long a fetched balance is reused. The storefront asks for stock
        // counts on every page load; the authoritative check happens again at
        // dispatch time. Set 0 to always fetch live.
        'balance_cache_seconds' => 120,
    ],

    // ---------------------------------------------------------------
    // Proxy checker
    //
    // Tests uploaded addresses by sending a request THROUGH each one to a
    // reflector on this site, so "working" means it carried a request rather
    // than merely accepting a connection.
    //
    // Leave echo_url empty to use {public_base_url}/api/proxies/echo, which is
    // correct for any normal deployment. Set it only if the public URL is not
    // reachable from the server itself (e.g. testing on localhost).
    // ---------------------------------------------------------------
    'proxycheck' => [
        'echo_url' => '',
        // Per-attempt limit. A proxy slower than this reads as dead, which is
        // the honest answer for anything a buyer would wait on.
        'timeout_seconds' => 8,
        // Addresses tested at once. Higher finishes a batch sooner but opens
        // more sockets; 10 is comfortable on shared hosting.
        'concurrency' => 10,
        // Caps so one click cannot hold a PHP worker for minutes.
        'max_admin' => 100,
        'max_buyer' => 50,
        // Allow checking private/loopback addresses. Off for stock (an
        // unroutable address is a guaranteed support ticket), and this only
        // widens what the CHECKER will probe — uploads stay strict. Turn it on
        // only to test a proxy on your own network.
        'allow_private' => false,
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
    // Console equivalent: General → Public site URL
    'public_base_url' => 'https://your-domain.example',

    // Where the order ledger, stock queue and console settings are written.
    // NOT editable from the console: moving it would move the file the console
    // is reading. Keep it outside the web root if your host allows it; otherwise
    // the bundled .htaccess blocks HTTP access.
    'data_dir' => __DIR__ . '/data',

    // Refuse to start a payment if a matching order was never recorded.
    'require_known_order' => true,

    // Upper bound on a single KES charge, as a sanity guard (0 = no limit).
    'max_kes_amount' => 500000,

    // Emit permissive CORS headers on the API. Only needed if you call these
    // endpoints from a different origin; server-to-server webhooks ignore it.
    'allow_cors' => false,
];
