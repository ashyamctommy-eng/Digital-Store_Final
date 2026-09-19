<?php
/**
 * NOWPayments client (crypto invoices) and IPN signature verification.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';

function nowpayments_is_configured(array $config): bool
{
    return trim((string) config_value($config, 'nowpayments.api_key', '')) !== '';
}

/**
 * Creates a hosted invoice.
 *
 * `ipn_callback_url` is where NOWPayments posts the settlement notification —
 * it must be a public HTTPS URL, so it always comes from config rather than
 * the request body.
 *
 * @return array{ok:bool, data:?array, error:?string, errorCode:?string}
 */
function nowpayments_create_invoice(array $config, array $params): array
{
    $base = rtrim((string) config_value($config, 'nowpayments.api_base'), '/');
    $publicBase = rtrim((string) config_value($config, 'public_base_url', ''), '/');

    $payload = [
        // Exact base-USD amount, per spec.
        'price_amount' => round((float) $params['price_usd'], 2),
        'price_currency' => 'usd',
        'order_id' => $params['order_id'],
        'order_description' => $params['description'],
        'ipn_callback_url' => $publicBase . '/api/nowpayments/webhook',
        'is_fixed_rate' => true,
    ];

    if (!empty($params['success_url'])) {
        $payload['success_url'] = $params['success_url'];
    }
    if (!empty($params['cancel_url'])) {
        $payload['cancel_url'] = $params['cancel_url'];
    }

    $res = http_json_request(
        'POST',
        $base . '/invoice',
        ['x-api-key' => (string) config_value($config, 'nowpayments.api_key')],
        $payload,
        45
    );

    if ($res['error'] !== null) {
        return [
            'ok' => false,
            'data' => null,
            'error' => 'Could not reach NOWPayments: ' . $res['error'],
            'errorCode' => 'GATEWAY_UNREACHABLE',
        ];
    }

    $body = $res['body'] ?? [];

    if ($res['status'] >= 200 && $res['status'] < 300 && !empty($body['invoice_url'])) {
        return ['ok' => true, 'data' => $body, 'error' => null, 'errorCode' => null];
    }

    return [
        'ok' => false,
        'data' => null,
        'error' => is_string($body['message'] ?? null)
            ? $body['message']
            : 'NOWPayments rejected the invoice request.',
        'errorCode' => 'GATEWAY_ERROR',
    ];
}

/** Fetches a payment by id, used to confirm an IPN out of band. */
/**
 * API reachability and key validity.
 *
 * `GET /status` is the documented liveness endpoint and needs no key; calling an
 * authenticated endpoint as well is what actually proves the key works.
 *
 * @return array{ok:bool, message:?string, error:?string, http:int}
 */
function nowpayments_status(array $config): array
{
    if (!nowpayments_is_configured($config)) {
        return ['ok' => false, 'message' => null, 'error' => 'No NOWPayments API key is set.', 'http' => 0];
    }

    $base = rtrim((string) config_value($config, 'nowpayments.api_base', 'https://api.nowpayments.io/v1'), '/');

    $ping = http_json_request('GET', $base . '/status', [], null, 15);
    if ($ping['error'] !== null) {
        return ['ok' => false, 'message' => null, 'error' => 'Could not reach NOWPayments: ' . $ping['error'], 'http' => 0];
    }

    // An authenticated call is the real test: /status answers without a key.
    $auth = http_json_request(
        'GET',
        $base . '/currencies',
        ['x-api-key' => (string) config_value($config, 'nowpayments.api_key', '')],
        null,
        15
    );

    if ($auth['error'] !== null) {
        return ['ok' => false, 'message' => null, 'error' => 'Could not reach NOWPayments: ' . $auth['error'], 'http' => 0];
    }

    if ($auth['status'] === 401 || $auth['status'] === 403) {
        return ['ok' => false, 'message' => null, 'error' => 'NOWPayments rejected that API key.', 'http' => $auth['status']];
    }

    $message = is_array($ping['body']) ? ($ping['body']['message'] ?? null) : null;

    return [
        'ok' => $auth['status'] >= 200 && $auth['status'] < 300,
        'message' => is_string($message) ? $message : null,
        'error' => $auth['status'] >= 200 && $auth['status'] < 300
            ? null
            : 'NOWPayments answered with HTTP ' . $auth['status'] . '.',
        'http' => $auth['status'],
    ];
}

function nowpayments_get_payment(array $config, string $paymentId): ?array
{
    $base = rtrim((string) config_value($config, 'nowpayments.api_base'), '/');
    $res = http_json_request(
        'GET',
        $base . '/payment/' . rawurlencode($paymentId),
        ['x-api-key' => (string) config_value($config, 'nowpayments.api_key')]
    );

    if ($res['error'] !== null || $res['status'] < 200 || $res['status'] >= 300) {
        return null;
    }
    return is_array($res['body'] ?? null) ? $res['body'] : null;
}

/** Recursively sorts array keys — required before signing/verifying. */
function nowpayments_sort_recursive(array $data): array
{
    foreach ($data as $key => $value) {
        if (is_array($value)) {
            $data[$key] = nowpayments_sort_recursive($value);
        }
    }
    ksort($data);
    return $data;
}

/**
 * Verifies the `x-nowpayments-sig` header.
 *
 * NOWPayments signs the JSON body with HMAC-SHA512 using the IPN secret, over
 * a payload whose keys are sorted in ascending order.
 */
function nowpayments_verify_ipn(array $config, string $rawBody, ?string $signature): bool
{
    $secret = trim((string) config_value($config, 'nowpayments.ipn_secret', ''));
    if ($secret === '' || $signature === null || $signature === '') {
        return false;
    }

    $decoded = json_decode($rawBody, true);
    if (!is_array($decoded)) {
        return false;
    }

    $sorted = nowpayments_sort_recursive($decoded);
    $sortedJson = json_encode($sorted, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($sortedJson === false) {
        return false;
    }

    $expected = hash_hmac('sha512', $sortedJson, $secret);

    return hash_equals($expected, strtolower($signature));
}

/** Maps a NOWPayments payment_status to our internal order status. */
function nowpayments_map_status(?string $status): string
{
    switch (strtolower((string) $status)) {
        case 'finished':
        case 'confirmed':
            return 'paid';
        case 'failed':
            return 'failed';
        case 'refunded':
            return 'cancelled';
        case 'expired':
            return 'expired';
        // waiting / confirming / sending / partially_paid
        default:
            return 'pending';
    }
}
