<?php
/**
 * smsotp.net client — on-demand SMS activations.
 *
 * API v1.0, documented at https://smsotp.net/api-support
 *
 *   GET {base}/get-balance?api_key=
 *       -> {"success":true,"data":{"balance":"99.94"}}
 *   GET {base}/otp/rent?api_key=&service_id=&country_id=&server_id=&provider_id=
 *       -> {"success":true,"data":{"phoneNumber":…,"smsPhoneId":…,"operator":…}}
 *   GET {base}/otp/info?api_key=&sms_phone_id=
 *       -> {"success":true,"data":{"smsCode":…,"smsText":…}}
 *   GET {base}/services?api_key=
 *       -> {"success":true,"data":[{"id":"tg","name":"Telegram"}, …]}
 *
 * Every response wraps its payload in `data`, and failures come back as
 * `{"success":false,"message":"…"}` with HTTP 200, so the status code alone is
 * not enough to tell success from failure.
 *
 * This is only ever called server-side: it spends real money on the store's
 * balance, and the API key must not be exposed to the browser.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/store.php';

function smsotp_api_key(array $config): string
{
    return trim((string) config_value($config, 'smsotp.api_key', ''));
}

function smsotp_is_configured(array $config): bool
{
    return smsotp_api_key($config) !== '';
}

function smsotp_base_url(array $config): string
{
    return rtrim(
        (string) config_value($config, 'smsotp.api_base', 'https://smsotp.net/api/v1'),
        '/'
    );
}

/**
 * Calls an endpoint and normalises the envelope.
 *
 * @return array{ok:bool, data:mixed, message:string|null, http:int}
 */
function smsotp_call(array $config, string $path, array $params = [], int $timeout = 25): array
{
    $params['api_key'] = smsotp_api_key($config);
    $url = smsotp_base_url($config) . '/' . ltrim($path, '/') . '?' . http_build_query($params);

    $res = http_json_request('GET', $url, [], null, $timeout);

    if ($res['error'] !== null) {
        return ['ok' => false, 'data' => null, 'message' => 'Could not reach the SMS provider: ' . $res['error'], 'http' => 0];
    }

    $body = $res['body'];
    if (!is_array($body)) {
        return ['ok' => false, 'data' => null, 'message' => 'The SMS provider returned an unreadable response.', 'http' => $res['status']];
    }

    if (($body['success'] ?? false) !== true) {
        $message = $body['message'] ?? $body['error'] ?? 'The SMS provider rejected the request.';
        return [
            'ok' => false,
            'data' => null,
            'message' => is_string($message) ? $message : 'The SMS provider rejected the request.',
            'http' => $res['status'],
        ];
    }

    return ['ok' => true, 'data' => $body['data'] ?? null, 'message' => $body['message'] ?? null, 'http' => $res['status']];
}

/**
 * Unwraps `data`, which is sometimes an object and sometimes a
 * single-element list (the provider's docs show both shapes).
 */
function smsotp_data_object($data): ?array
{
    if (!is_array($data)) {
        return null;
    }
    if (isset($data[0]) && is_array($data[0])) {
        return $data[0];
    }
    // A list of scalars is not an object.
    if (array_is_list($data) && $data !== []) {
        return null;
    }
    return $data;
}

/** Account balance. */
function smsotp_balance(array $config): array
{
    if (!smsotp_is_configured($config)) {
        return ['ok' => false, 'balance' => 0.0, 'error' => 'not_configured'];
    }

    $res = smsotp_call($config, 'get-balance');
    if (!$res['ok']) {
        return ['ok' => false, 'balance' => 0.0, 'error' => $res['message']];
    }

    $data = smsotp_data_object($res['data']) ?? [];
    $balance = $data['balance'] ?? null;
    if (!is_numeric($balance)) {
        return ['ok' => false, 'balance' => 0.0, 'error' => 'Unexpected balance response.'];
    }

    return ['ok' => true, 'balance' => (float) $balance, 'error' => null];
}

/** True when the provider is configured and holds a spendable balance. */
function smsotp_can_purchase(array $config, ?float $minBalance = null): bool
{
    if (!smsotp_is_configured($config)) {
        return false;
    }
    $balance = smsotp_balance($config);
    if (!$balance['ok']) {
        return false;
    }
    $minimum = $minBalance ?? (float) config_value($config, 'smsotp.min_balance', 0.01);
    return $balance['balance'] > $minimum;
}

/**
 * Buys one activation (one phone number).
 *
 * @return array{ok:bool, phone:?string, sms_phone_id:?string, operator:?string, error:?string}
 */
function smsotp_rent(array $config, string $serviceId, string $countryId, string $serverId = '1', string $providerId = ''): array
{
    if (!smsotp_is_configured($config)) {
        return ['ok' => false, 'phone' => null, 'sms_phone_id' => null, 'operator' => null, 'error' => 'not_configured'];
    }

    $params = [
        'service_id' => $serviceId,
        'country_id' => $countryId,
        'server_id' => $serverId,
    ];
    // Only server_id 3 needs an explicit provider.
    if ($providerId !== '') {
        $params['provider_id'] = $providerId;
    }

    $res = smsotp_call($config, 'otp/rent', $params, 40);
    if (!$res['ok']) {
        return ['ok' => false, 'phone' => null, 'sms_phone_id' => null, 'operator' => null, 'error' => $res['message']];
    }

    $data = smsotp_data_object($res['data']);
    if ($data === null || !isset($data['phoneNumber'])) {
        return ['ok' => false, 'phone' => null, 'sms_phone_id' => null, 'operator' => null, 'error' => 'No number was returned.'];
    }

    // The provider returns the number as a bare integer (e.g. 14535366633).
    $phone = preg_replace('/[^\d+]/', '', (string) $data['phoneNumber']) ?? '';
    if ($phone === '') {
        return ['ok' => false, 'phone' => null, 'sms_phone_id' => null, 'operator' => null, 'error' => 'The returned number was empty.'];
    }
    if (!str_starts_with($phone, '+')) {
        $phone = '+' . $phone;
    }

    return [
        'ok' => true,
        'phone' => $phone,
        'sms_phone_id' => isset($data['smsPhoneId']) ? (string) $data['smsPhoneId'] : null,
        'operator' => isset($data['operator']) ? (string) $data['operator'] : null,
        'error' => null,
    ];
}

/**
 * Polls an activation for the arriving code.
 *
 * @return array{ok:bool, code:?string, text:?string, pending:bool, error:?string}
 */
function smsotp_info(array $config, string $smsPhoneId): array
{
    if (!smsotp_is_configured($config)) {
        return ['ok' => false, 'code' => null, 'text' => null, 'pending' => false, 'error' => 'not_configured'];
    }

    $res = smsotp_call($config, 'otp/info', ['sms_phone_id' => $smsPhoneId], 20);
    if (!$res['ok']) {
        return ['ok' => false, 'code' => null, 'text' => null, 'pending' => false, 'error' => $res['message']];
    }

    $data = smsotp_data_object($res['data']) ?? [];
    $rawCode = $data['smsCode'] ?? null;
    $code = is_scalar($rawCode) ? trim((string) $rawCode) : '';
    $text = isset($data['smsText']) && is_string($data['smsText']) ? $data['smsText'] : null;

    if ($code === '' && $text !== null) {
        $code = smsotp_extract_code($text);
    }

    return [
        'ok' => true,
        'code' => $code !== '' ? $code : null,
        'text' => $text,
        // No code yet simply means the SMS has not arrived.
        'pending' => $code === '',
        'error' => null,
    ];
}

/** Pulls a verification code out of a raw SMS body. */
function smsotp_extract_code(string $text): string
{
    if (preg_match('/\b(\d{4,8})\b/', $text, $m) === 1) {
        return $m[1];
    }
    return '';
}

/** Available services, used by the admin console to verify service codes. */
function smsotp_services(array $config): array
{
    if (!smsotp_is_configured($config)) {
        return [];
    }
    $res = smsotp_call($config, 'services');
    if (!$res['ok'] || !is_array($res['data'])) {
        return [];
    }
    $out = [];
    foreach ($res['data'] as $row) {
        if (is_array($row) && isset($row['id'])) {
            $out[] = ['id' => (string) $row['id'], 'name' => (string) ($row['name'] ?? '')];
        }
    }
    return $out;
}

/**
 * Balance with a short cache.
 *
 * The storefront asks for stock counts on every page load; hitting the
 * provider's balance endpoint that often would be slow and rate-limit prone.
 * Two minutes of staleness is fine because the authoritative check happens
 * again at dispatch time, after the order is paid.
 */
function smsotp_balance_cached(array $config, ?int $ttlSeconds = null): array
{
    if (!smsotp_is_configured($config)) {
        return ['ok' => false, 'balance' => 0.0, 'error' => 'not_configured', 'cached' => false];
    }

    if ($ttlSeconds === null) {
        $ttlSeconds = (int) config_value($config, 'smsotp.balance_cache_seconds', 120);
    }

    $path = store_data_dir($config) . '/smsotp-balance.json';

    if (is_file($path)) {
        $raw = @file_get_contents($path);
        $cached = $raw === false ? null : json_decode($raw, true);
        if (is_array($cached) && isset($cached['at'], $cached['balance'])) {
            if (time() - (int) $cached['at'] < $ttlSeconds) {
                return [
                    'ok' => (bool) ($cached['ok'] ?? false),
                    'balance' => (float) $cached['balance'],
                    'error' => $cached['error'] ?? null,
                    'cached' => true,
                ];
            }
        }
    }

    $fresh = smsotp_balance($config);

    $tmp = $path . '.tmp';
    if (@file_put_contents($tmp, json_encode([
        'at' => time(),
        'ok' => $fresh['ok'],
        'balance' => $fresh['balance'],
        'error' => $fresh['error'],
    ]), LOCK_EX) !== false) {
        @rename($tmp, $path);
        @chmod($path, 0640);
    }

    $fresh['cached'] = false;
    return $fresh;
}
