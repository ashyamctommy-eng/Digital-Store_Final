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
    'public_base_url' => (string) config_value($config, 'public_base_url', ''),
    'data_dir_writable' => (bool) $writable,
    'php_version' => PHP_VERSION,
]);
