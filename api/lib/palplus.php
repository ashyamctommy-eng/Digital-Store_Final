<?php
/**
 * Palplus API client (M-Pesa STK push).
 *
 * Uses the shared HTTP helper from lib/http.php.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';

/** Resolves the Palplus base URL for the configured mode. */
function palplus_base_url(array $config): string
{
    $mode = (string) config_value($config, 'mode', 'sandbox');
    return $mode === 'live'
        ? (string) config_value($config, 'palplus.live_base')
        : (string) config_value($config, 'palplus.sandbox_base');
}

function palplus_is_configured(array $config): bool
{
    return trim((string) config_value($config, 'palplus.api_key', '')) !== '';
}

/** Builds the Authorization header for Palplus. */
function palplus_auth_header(array $config): string
{
    $key = trim((string) config_value($config, 'palplus.api_key', ''));
    $style = (string) config_value($config, 'palplus.auth_style', 'basic');

    // Documented behaviour: the key is the Basic username, password is empty.
    return $style === 'raw'
        ? 'Basic ' . $key
        : 'Basic ' . base64_encode($key . ':');
}

/**
 * Service wallet balance.
 *
 * Every STK push deducts its transaction fee from this wallet, and the request
 * fails with `INSUFFICIENT_SERVICE_BALANCE` (402) when it cannot cover the fee.
 * Without this the first symptom of an empty wallet is customers seeing failed
 * payments, which is a miserable way to find out.
 *
 * Response headers are returned too: the API allows 60 requests/minute per key
 * and reports the remaining window in `x-ratelimit-*`.
 *
 * @return array{ok:bool, balance:?float, currency:?string, error:?string, http:int, rate_limit:?int, rate_remaining:?int}
 */
function palplus_service_wallet(array $config): array
{
    if (!palplus_is_configured($config)) {
        return [
            'ok' => false, 'balance' => null, 'currency' => null, 'error' => 'No Palplus API key is set.',
            'http' => 0, 'rate_limit' => null, 'rate_remaining' => null,
        ];
    }

    $res = http_json_request(
        'GET',
        rtrim(palplus_base_url($config), '/') . '/wallets/service/balance',
        ['Authorization' => palplus_auth_header($config)],
        null,
        20
    );

    $rate = [
        'rate_limit' => isset($res['headers']['x-ratelimit-limit']) && is_numeric($res['headers']['x-ratelimit-limit'])
            ? (int) $res['headers']['x-ratelimit-limit'] : null,
        'rate_remaining' => isset($res['headers']['x-ratelimit-remaining']) && is_numeric($res['headers']['x-ratelimit-remaining'])
            ? (int) $res['headers']['x-ratelimit-remaining'] : null,
    ];

    if ($res['error'] !== null) {
        return array_merge($rate, [
            'ok' => false, 'balance' => null, 'currency' => null,
            'error' => 'Could not reach Palplus: ' . $res['error'], 'http' => 0,
        ]);
    }

    $body = $res['body'];
    if ($res['status'] < 200 || $res['status'] >= 300 || !is_array($body) || empty($body['success'])) {
        $message = $body['error']['message'] ?? null;
        return array_merge($rate, [
            'ok' => false, 'balance' => null, 'currency' => null,
            'error' => is_string($message)
                ? $message
                : 'Palplus rejected the request (HTTP ' . $res['status'] . ').',
            'http' => $res['status'],
        ]);
    }

    $data = is_array($body['data'] ?? null) ? $body['data'] : [];
    $wallet = is_array($data['wallet'] ?? null) ? $data['wallet'] : $data;

    $balance = $wallet['balance'] ?? $data['balance'] ?? null;
    $currency = $wallet['currency'] ?? $data['currency'] ?? 'KES';

    return array_merge($rate, [
        // Null when the shape differs: better to say "could not read it" than
        // to show a made-up balance.
        'ok' => is_numeric($balance),
        'balance' => is_numeric($balance) ? (float) $balance : null,
        'currency' => is_string($currency) ? $currency : 'KES',
        'error' => is_numeric($balance) ? null : 'Palplus answered, but the balance was not in the response.',
        'http' => $res['status'],
    ]);
}

/** Payment channels on the account, used to explain NO_DEFAULT_CHANNEL. */
function palplus_channels(array $config): array
{
    if (!palplus_is_configured($config)) {
        return [];
    }

    $res = http_json_request(
        'GET',
        rtrim(palplus_base_url($config), '/') . '/channels',
        ['Authorization' => palplus_auth_header($config)],
        null,
        20
    );

    $body = $res['body'];
    if ($res['error'] !== null || !is_array($body) || empty($body['success'])) {
        return [];
    }

    $rows = $body['data']['channels'] ?? $body['data'] ?? [];
    if (!is_array($rows) || !array_is_list($rows)) {
        return [];
    }

    $out = [];
    foreach ($rows as $row) {
        if (is_array($row)) {
            $out[] = [
                'id' => (string) ($row['id'] ?? ''),
                'name' => (string) ($row['name'] ?? ''),
                'type' => (string) ($row['type'] ?? ''),
                'shortcode' => (string) ($row['shortcode'] ?? ''),
                'is_default' => (bool) ($row['isDefault'] ?? $row['is_default'] ?? false),
            ];
        }
    }
    return $out;
}

/**
 * Initiates an STK push.
 *
 * @return array{ok:bool, status:int, data:array|null, error:?string, errorCode:?string}
 */
function palplus_initiate_stk(array $config, array $params): array
{
    $base = palplus_base_url($config);
    $channelId = trim((string) config_value($config, 'palplus.channel_id', ''));

    $payload = [
        // M-Pesa expects a whole-shilling integer.
        'amount' => (int) $params['amount'],
        'phone' => $params['phone'],
        // Hard 12-character limit imposed by M-Pesa.
        'accountReference' => substr($params['account_reference'], 0, 12),
        // Hard 13-character limit.
        'transactionDesc' => substr($params['transaction_desc'], 0, 13),
        'callbackUrl' => $params['callback_url'],
    ];

    if ($channelId !== '') {
        $payload['channelId'] = $channelId;
    }

    $res = http_json_request(
        'POST',
        rtrim($base, '/') . '/payments/stk',
        ['Authorization' => palplus_auth_header($config)],
        $payload
    );

    if ($res['error'] !== null) {
        return [
            'ok' => false,
            'status' => 0,
            'data' => null,
            'error' => 'Could not reach Palplus: ' . $res['error'],
            'errorCode' => 'GATEWAY_UNREACHABLE',
        ];
    }

    $body = $res['body'] ?? [];

    if ($res['status'] >= 200 && $res['status'] < 300 && !empty($body['success'])) {
        return [
            'ok' => true,
            'status' => $res['status'],
            'data' => is_array($body['data'] ?? null) ? $body['data'] : [],
            'error' => null,
            'errorCode' => null,
        ];
    }

    // Surface the provider's own error code so the UI can explain it.
    $code = $body['code'] ?? $body['errorCode'] ?? null;
    $message = $body['message'] ?? $body['error'] ?? 'Palplus rejected the request.';

    $friendly = [
        'NO_PAYMENT_CHANNELS' => 'No M-Pesa payment channel is configured on the Palplus account.',
        'NO_DEFAULT_CHANNEL' => 'The Palplus account has no default payment channel set.',
        'CHANNEL_NOT_FOUND' => 'The configured Palplus channel was not found.',
        'INVALID_PHONE' => 'That phone number was not accepted. Use 07XXXXXXXX or 254XXXXXXXXX.',
        'INSUFFICIENT_SERVICE_BALANCE' => 'The store wallet is too low to cover the M-Pesa fee. Please top up.',
        'STK_TEMP_BANNED' => 'M-Pesa requests are temporarily paused. Please try again later.',
    ];

    return [
        'ok' => false,
        'status' => $res['status'],
        'data' => null,
        'error' => $friendly[$code] ?? (is_string($message) ? $message : 'Palplus rejected the request.'),
        'errorCode' => is_string($code) ? $code : 'GATEWAY_ERROR',
    ];
}

/**
 * Fetches a transaction from Palplus.
 *
 * Webhook payloads are NOT signed, so this is the authoritative source of
 * truth: the webhook only tells us *which* transaction to look up.
 */
function palplus_get_transaction(array $config, string $transactionId): ?array
{
    $base = palplus_base_url($config);
    $res = http_json_request(
        'GET',
        rtrim($base, '/') . '/transactions/' . rawurlencode($transactionId),
        ['Authorization' => palplus_auth_header($config)]
    );

    if ($res['error'] !== null || $res['status'] < 200 || $res['status'] >= 300) {
        return null;
    }

    $body = $res['body'] ?? [];
    $data = $body['data'] ?? $body;

    return is_array($data) ? $data : null;
}

/** Maps a Palplus status to our internal order status. */
function palplus_map_status(?string $status): string
{
    switch (strtoupper((string) $status)) {
        case 'SUCCESS':
        case 'SUCCESSFUL':
        case 'COMPLETED':
            return 'paid';
        case 'FAILED':
            return 'failed';
        case 'CANCELLED':
        case 'CANCELED':
            return 'cancelled';
        case 'EXPIRED':
            return 'expired';
        default:
            return 'pending';
    }
}
