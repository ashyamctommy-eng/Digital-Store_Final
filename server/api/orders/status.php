<?php
/**
 * GET /api/orders/status?order_id=...
 *
 * The only way the browser learns an order's status. For Palplus it re-checks
 * with the provider when the ledger still says pending, so polling keeps
 * working even if a webhook was missed.
 *
 * Response { order_id, status, gateway, amount, currency, reference, message }
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/palplus.php';

$config = load_config();
apply_cors($config);
require_method('GET');

$orderId = clean_str($_GET['order_id'] ?? '', 96);
if ($orderId === '') {
    json_error('order_id is required.', 422, 'MISSING_ORDER_ID');
}

$order = store_read_order($config, $orderId);
if ($order === null) {
    json_error('Unknown order.', 404, 'ORDER_NOT_FOUND');
}

$status = (string) ($order['status'] ?? 'pending');
$gateway = (string) ($order['gateway'] ?? '');

// For M-Pesa, actively reconcile with Palplus while still pending. This covers
// the case where the webhook never arrived (shared hosting firewalls, etc).
if ($gateway === 'palplus' && $status === 'pending') {
    $transactionId = (string) ($order['palplus_transaction_id'] ?? '');

    if ($transactionId !== '') {
        $fresh = palplus_get_transaction($config, $transactionId);
        if ($fresh !== null) {
            $reconciled = palplus_map_status($fresh['status'] ?? null);

            if ($reconciled !== $status) {
                $expected = (int) ($order['amount_kes'] ?? 0);
                $paid = (int) ($fresh['amount'] ?? 0);

                if ($reconciled === 'paid' && $expected > 0 && $paid !== $expected) {
                    $reconciled = 'failed';
                    store_update_order($config, $orderId, [
                        'failure_reason' => 'amount_mismatch',
                        'paid_amount_kes' => $paid,
                        'expected_amount_kes' => $expected,
                    ]);
                }

                store_update_order($config, $orderId, [
                    'status' => $reconciled,
                    'mpesa_receipt' => $fresh['mpesa_receipt'] ?? null,
                    'palplus_status' => $fresh['status'] ?? null,
                    'settled_at' => $reconciled === 'paid' ? gmdate('c') : null,
                ]);

                store_log($config, 'orders.reconciled', [
                    'order_id' => $orderId,
                    'status' => $reconciled,
                ]);

                $status = $reconciled;
                $order['mpesa_receipt'] = $fresh['mpesa_receipt'] ?? null;
            }
        }
    }
}

$message = null;
if ($status === 'pending') {
    $message = 'Waiting for confirmation from the payment provider.';
} elseif ($status === 'failed') {
    $message = 'The payment did not go through. No funds were taken.';
} elseif ($status === 'cancelled') {
    $message = 'The payment was cancelled.';
} elseif ($status === 'expired') {
    $message = 'The payment request expired before it was completed.';
}

json_ok([
    'order_id' => $orderId,
    'status' => $status,
    'gateway' => $gateway,
    'currency' => $order['currency'] ?? null,
    'amount' => $order['amount_kes'] ?? $order['amount_usd'] ?? null,
    'reference' => $order['mpesa_receipt']
        ?? $order['nowpayments_payment_id']
        ?? $order['nowpayments_invoice_id']
        ?? null,
    'message' => $message,
]);
