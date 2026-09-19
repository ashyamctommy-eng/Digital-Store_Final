<?php
/**
 * POST /api/palplus/webhook
 *
 * Receives the M-Pesa transaction result from Palplus.
 *
 * SECURITY NOTE: Palplus does not sign its callbacks, so the payload is treated
 * as a hint only. We take the transaction id from the body and re-fetch the
 * transaction from the Palplus API — that response is authoritative. A forged
 * webhook therefore cannot mark an order as paid.
 *
 * Always answers 2xx so Palplus does not retry unnecessarily. Stock is claimed
 * and the credentials email is sent AFTER the response is flushed.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/palplus.php';
require_once __DIR__ . '/../lib/pricing.php';
require_once __DIR__ . '/../lib/email.php';

$config = load_config();
require_method('POST');

$rawBody = file_get_contents('php://input') ?: '';
$body = json_decode($rawBody, true);
if (!is_array($body)) {
    json_response_then(['ok' => true, 'ignored' => 'unparseable body'], static function () {});
}

$transaction = $body['transaction'] ?? [];
$eventType = (string) ($body['event_type'] ?? '');
$transactionId = (string) ($transaction['id'] ?? '');
$accountRef = (string) ($transaction['external_reference'] ?? '');

store_log($config, 'palplus.webhook', [
    'event_type' => $eventType,
    'transaction_id' => $transactionId,
    'account_reference' => $accountRef,
]);

$noop = static function () {};

if ($transactionId === '' && $accountRef === '') {
    json_response_then(['ok' => true, 'ignored' => 'no transaction id or reference'], $noop);
}

// Locate our order via the 12-character M-Pesa reference.
$order = $accountRef !== ''
    ? store_find_by_account_reference($config, $accountRef)
    : null;

if ($order === null) {
    store_log($config, 'palplus.webhook.unmatched', ['account_reference' => $accountRef]);
    json_response_then(['ok' => true, 'ignored' => 'unknown order'], $noop);
}

$orderId = (string) $order['order_id'];

// Already settled — idempotent no-op.
if (($order['status'] ?? '') === 'paid') {
    json_response_then(['ok' => true, 'already' => 'paid'], $noop);
}

// Authoritative re-fetch. The payload alone is not trusted.
$authoritative = $transactionId !== ''
    ? palplus_get_transaction($config, $transactionId)
    : null;

if ($authoritative === null) {
    store_log($config, 'palplus.webhook.unverified', [
        'order_id' => $orderId,
        'transaction_id' => $transactionId,
    ]);
    // Acknowledge anyway; the status poller will confirm via the API.
    json_response_then(['ok' => true, 'deferred' => 'could not verify with provider'], $noop);
}

$providerStatus = palplus_map_status($authoritative['status'] ?? null);
$receipt = $authoritative['mpesa_receipt'] ?? null;
$paidAmount = (int) ($authoritative['amount'] ?? 0);

// What the order SHOULD have cost, recomputed from the catalog rather than read
// back from the record. Trusting `$order['amount_kes']` would compare the paid
// amount against a number that originated in the request body — the check would
// pass for any amount a buyer chose. Falls back to the stored figure only when
// the cart cannot be priced (an order written before pricing moved server-side).
$catalogAmount = pricing_total_kes($config, dispatch_normalise_items($order['items'] ?? []));
$expectedAmount = $catalogAmount ?? (int) ($order['amount_kes'] ?? 0);

if ($catalogAmount !== null && $catalogAmount !== (int) ($order['amount_kes'] ?? 0)) {
    store_log($config, 'palplus.webhook.ledger_amount_drift', [
        'order_id' => $orderId,
        'ledger_amount_kes' => (int) ($order['amount_kes'] ?? 0),
        'catalog_amount_kes' => $catalogAmount,
    ]);
}

// Guard against a tampered or mismatched amount.
if ($providerStatus === 'paid' && $expectedAmount > 0 && $paidAmount !== $expectedAmount) {
    store_update_order($config, $orderId, [
        'status' => 'failed',
        'failure_reason' => 'amount_mismatch',
        'paid_amount_kes' => $paidAmount,
        'expected_amount_kes' => $expectedAmount,
    ]);
    store_log($config, 'palplus.webhook.amount_mismatch', [
        'order_id' => $orderId,
        'paid' => $paidAmount,
        'expected' => $expectedAmount,
    ]);
    json_response_then(['ok' => true, 'rejected' => 'amount mismatch'], $noop);
}

store_update_order($config, $orderId, [
    'status' => $providerStatus,
    'mpesa_receipt' => $receipt,
    'paid_amount_kes' => $paidAmount,
    'palplus_status' => $authoritative['status'] ?? null,
    'result_code' => $authoritative['result_code'] ?? null,
    'result_desc' => $authoritative['result_desc'] ?? null,
    'settled_at' => $providerStatus === 'paid' ? gmdate('c') : null,
]);

store_log($config, 'palplus.webhook.settled', [
    'order_id' => $orderId,
    'status' => $providerStatus,
    'mpesa_receipt' => $receipt,
]);

$response = ['ok' => true, 'order_id' => $orderId, 'status' => $providerStatus];

// Confirm to Palplus first, then hand over the goods.
if ($providerStatus === 'paid') {
    json_response_then($response, static function () use ($config, $orderId) {
        settle_paid_order($config, $orderId);
    });
}

json_response_then($response, $noop);
