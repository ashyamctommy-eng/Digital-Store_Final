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
 * Always answers 2xx so Palplus does not retry unnecessarily.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/palplus.php';

$config = load_config();
require_method('POST');

$rawBody = file_get_contents('php://input') ?: '';
$body = json_decode($rawBody, true);
if (!is_array($body)) {
    http_response_code(200);
    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'ignored' => 'unparseable body']);
    exit;
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

/** Acknowledges the delivery and stops. */
function ack(array $payload = []): void
{
    http_response_code(200);
    header('Content-Type: application/json');
    echo json_encode(array_merge(['ok' => true], $payload));
    exit;
}

if ($transactionId === '' && $accountRef === '') {
    ack(['ignored' => 'no transaction id or reference']);
}

// Locate our order via the 12-character M-Pesa reference.
$order = $accountRef !== ''
    ? store_find_by_account_reference($config, $accountRef)
    : null;

if ($order === null) {
    store_log($config, 'palplus.webhook.unmatched', ['account_reference' => $accountRef]);
    ack(['ignored' => 'unknown order']);
}

$orderId = (string) $order['order_id'];

// Already settled — idempotent no-op.
if (($order['status'] ?? '') === 'paid') {
    ack(['already' => 'paid']);
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
    // Acknowledge anyway; the poller will confirm via the status endpoint.
    ack(['deferred' => 'could not verify with provider']);
}

$providerStatus = palplus_map_status($authoritative['status'] ?? null);
$receipt = $authoritative['mpesa_receipt'] ?? null;
$paidAmount = (int) ($authoritative['amount'] ?? 0);
$expectedAmount = (int) ($order['amount_kes'] ?? 0);

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
    ack(['rejected' => 'amount mismatch']);
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

ack(['order_id' => $orderId, 'status' => $providerStatus]);
