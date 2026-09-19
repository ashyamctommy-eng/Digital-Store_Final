<?php
/**
 * Palplus API client (M-Pesa STK push) and the HTTP helper it shares with
 * the NOWPayments client.
 */

declare(strict_types=1);

/**
 * Minimal JSON HTTP client.
 *
 * @return array{status:int, body:array|null, raw:string, error:string|null}
 */
function http_json_request(
    string $method,
    string $url,
    array $headers = [],
    ?array $payload = null,
    int $timeoutSeconds = 30
): array {
    $ch = curl_init($url);

    $headerLines = [];
    foreach ($headers as $key => $value) {
        $headerLines[] = $key . ': ' . $value;
    }
    $headerLines[] = 'Accept: application/json';

    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_TIMEOUT => $timeoutSeconds,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => $headerLines,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'DigitalHubShop/1.0',
    ];

    if ($payload !== null) {
        $options[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_SLASHES);
        $headerLines[] = 'Content-Type: application/json';
        $options[CURLOPT_HTTPHEADER] = $headerLines;
    }

    curl_setopt_array($ch, $options);

    $raw = curl_exec($ch);
    $error = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false) {
        return ['status' => 0, 'body' => null, 'raw' => '', 'error' => $error ?: 'network error'];
    }

    $decoded = json_decode((string) $raw, true);

    return [
        'status' => $status,
        'body' => is_array($decoded) ? $decoded : null,
        'raw' => substr((string) $raw, 0, 2000),
        'error' => null,
    ];
}

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
