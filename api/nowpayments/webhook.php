<?php
/**
 * POST /api/nowpayments/webhook   (IPN)
 *
 * Receives settlement notifications from NOWPayments.
 *
 * Authentication: the request is signed with HMAC-SHA512 over the key-sorted
 * JSON body, using the IPN secret, and sent in the `x-nowpayments-sig` header.
 * A request that fails verification is rejected with 403 and never touches
 * order state — this is what stops a forged callback from marking an order paid.
 *
 * Stock is claimed and the credentials email sent AFTER the response is flushed.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/nowpayments.php';
require_once __DIR__ . '/../lib/pricing.php';
require_once __DIR__ . '/../lib/dispatch.php';
require_once __DIR__ . '/../lib/email.php';

$config = load_config();
require_method('POST');

$rawBody = file_get_contents('php://input') ?: '';
$signature = $_SERVER['HTTP_X_NOWPAYMENTS_SIG'] ?? null;

store_log($config, 'nowpayments.webhook.received', [
    'bytes' => strlen($rawBody),
    'has_signature' => $signature !== null,
]);

$noop = static function () {};

if (!nowpayments_verify_ipn($config, $rawBody, $signature)) {
    store_log($config, 'nowpayments.webhook.rejected', ['reason' => 'bad_signature']);
    json_error('Invalid signature.', 403, 'INVALID_SIGNATURE');
}

$body = json_decode($rawBody, true);
if (!is_array($body)) {
    json_error('Unparseable payload.', 400, 'BAD_PAYLOAD');
}

$orderId = (string) ($body['order_id'] ?? '');
$paymentStatus = (string) ($body['payment_status'] ?? '');
$paymentId = (string) ($body['payment_id'] ?? '');
$payCurrency = (string) ($body['pay_currency'] ?? '');
$priceAmount = $body['price_amount'] ?? null;

if ($orderId === '') {
    json_error('Missing order_id.', 422, 'MISSING_ORDER_ID');
}

$order = store_read_order($config, $orderId);
if ($order === null) {
    store_log($config, 'nowpayments.webhook.unmatched', ['order_id' => $orderId]);
    // 200 so NOWPayments does not retry an order we simply do not have.
    json_response_then(['ok' => true, 'ignored' => 'unknown order'], $noop);
}

// Idempotent: never regress a settled order.
if (($order['status'] ?? '') === 'paid') {
    json_response_then(['ok' => true, 'already' => 'paid'], $noop);
}

$status = nowpayments_map_status($paymentStatus);

// Optional second check: confirm with the API before marking paid.
if ($status === 'paid' && $paymentId !== '') {
    $verified = nowpayments_get_payment($config, $paymentId);
    if ($verified !== null) {
        $status = nowpayments_map_status($verified['payment_status'] ?? null);
    }
}

// Amount check. Without this, an invoice raised for any amount at all settles
// as paid: the signature proves the callback is genuinely from NOWPayments, not
// that the right amount was paid.
$expectedUsd = pricing_total_usd(dispatch_normalise_items($order['items'] ?? []))
    ?? (float) ($order['amount_usd'] ?? 0);
$settledPrice = $verified['price_amount'] ?? $priceAmount;

if (
    $status === 'paid'
    && $expectedUsd > 0
    && $settledPrice !== null
    && abs((float) $settledPrice - $expectedUsd) > PRICING_TOLERANCE_CENTS
) {
    store_update_order($config, $orderId, [
        'status' => 'failed',
        'failure_reason' => 'amount_mismatch',
        'paid_amount_usd' => (float) $settledPrice,
        'expected_amount_usd' => $expectedUsd,
    ]);
    store_log($config, 'nowpayments.webhook.amount_mismatch', [
        'order_id' => $orderId,
        'paid' => (float) $settledPrice,
        'expected' => $expectedUsd,
    ]);
    json_response_then(['ok' => true, 'rejected' => 'amount mismatch'], $noop);
}

store_update_order($config, $orderId, [
    'status' => $status,
    'nowpayments_payment_id' => $paymentId,
    'nowpayments_status' => $paymentStatus,
    'pay_currency' => $payCurrency,
    'price_amount' => $priceAmount,
    'settled_at' => $status === 'paid' ? gmdate('c') : null,
]);

store_log($config, 'nowpayments.webhook.settled', [
    'order_id' => $orderId,
    'status' => $status,
    'payment_status' => $paymentStatus,
]);

$response = ['ok' => true, 'order_id' => $orderId, 'status' => $status];

if ($status === 'paid') {
    json_response_then($response, static function () use ($config, $orderId) {
        settle_paid_order($config, $orderId);
    });
}

json_response_then($response, $noop);
