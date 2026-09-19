<?php
/**
 * GET /api/config-status
 *
 * Reports which gateways the server has credentials for, so the admin console
 * can show a truthful status. Never exposes key material — only booleans and
 * the mode.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/palplus.php';
require_once __DIR__ . '/lib/nowpayments.php';
require_once __DIR__ . '/lib/smsotp.php';
require_once __DIR__ . '/lib/catalog.php';
require_once __DIR__ . '/lib/nextproxy.php';

$config = load_config();
apply_cors($config);
require_method('GET');

$mode = (string) config_value($config, 'mode', 'sandbox');

$dataDir = (string) config_value($config, 'data_dir', __DIR__ . '/data');
$writable = is_dir($dataDir) ? is_writable($dataDir) : is_writable(dirname($dataDir));

json_ok([
    'palplus' => [
        'configured' => palplus_is_configured($config),
        'mode' => $mode,
        'has_channel' => trim((string) config_value($config, 'palplus.channel_id', '')) !== '',
    ],
    'nowpayments' => [
        'configured' => nowpayments_is_configured($config),
        'mode' => $mode,
        'has_ipn_secret' => trim((string) config_value($config, 'nowpayments.ipn_secret', '')) !== '',
    ],
    'smsotp' => [
        'configured' => smsotp_is_configured($config),
        'balance' => smsotp_is_configured($config) ? smsotp_balance_cached($config)['balance'] : 0,
        'balance_ok' => smsotp_is_configured($config) ? smsotp_balance_cached($config)['ok'] : false,
        'sms_products' => count(catalog_sms_product_ids()),
    ],
    'nextproxy' => [
        // Deliberately not gated on a key: the provider serves its pool
        // publicly, so requiring one would report a working setup as broken.
        'configured' => nextproxy_is_configured($config),
        'enabled' => nextproxy_enabled($config),
        'key_present' => nextproxy_api_key($config) !== '',
        'key_source' => nextproxy_key_source($config),
        'proxy_products' => count(catalog_proxy_product_ids()),
    ],
    'resend' => [
        'configured' => trim((string) config_value($config, 'resend.api_key', '')) !== '',
    ],
    'public_base_url' => (string) config_value($config, 'public_base_url', ''),
    'data_dir_writable' => (bool) $writable,
    'php_version' => PHP_VERSION,
]);
