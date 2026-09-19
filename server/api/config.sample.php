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
    // NextProxy — on-demand proxy supply (delivery_kind "proxy")
    // Console: https://console.nextproxy.site
    //
    // Used ONLY as a fallback: pre-bought IP:PORT stock is always tried first,
    // so the provider is only called when that runs out.
    //
    // The API key is OPTIONAL. The provider serves its pool to unauthenticated
    // callers; a key is validated when supplied, and a wrong one fails every
    // request. Set it in the admin console, here, or via NEXTPROXY_API_KEY —
    // the admin console value wins.
    // ---------------------------------------------------------------
    'nextproxy' => [
        'api_key' => '',
        'api_base' => 'https://console.nextproxy.site',
        // The documented list route. `/api/list` returns the same pool.
        'list_path' => '/api/proxies',
        // 'header' sends X-API-Key; 'query' appends ?key= (the original spec);
        // 'both' sends it twice. Header keeps the key out of access logs.
        'auth_style' => 'header',
        // Off switch for the whole integration.
        'enabled' => true,
        // Credits/profile endpoint. LEAVE EMPTY — the provider has none
        // (`/api/profile` returns 404), and quota is read from the
        // x-ratelimit-* response headers instead. Only set this if your
        // account is ever given a real credits endpoint.
        'profile_path' => '',
        // Largest page to request; guests are capped at 100 by the provider.
        'max_batch' => 100,
        // Safety ceiling on the addresses a single order can buy.
        'max_per_order' => 500,
        'timeout_seconds' => 20,
        // --- Costs real credits. Read before changing. ---
        // Verified against a live key: every request that returns addresses
        // costs 1 credit whatever the limit (limit=1 and limit=100 both cost 1),
        // while /api/health is free. A free key comes with 1,000 credits.
        //
        // The storefront's "is this available?" check therefore uses the FREE
        // health endpoint, cached for health_cache_seconds. The sampled probe
        // below costs 1 credit, so it is cached for half an hour and only
        // refreshed when an admin asks for it.
        'health_path' => '/api/health',
        'health_cache_seconds' => 600,
        'status_cache_seconds' => 1800,
        // How many sample addresses the admin console shows (still 1 credit).
        'status_sample' => 3,
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
