<?php
/**
 * POST /api/nowpayments/create-invoice
 *
 * Creates a hosted crypto invoice and returns its checkout URL.
 * The NOWPayments API key never leaves this server.
 *
 * Request  { orderId, priceUsd, description, successUrl?, cancelUrl? }
 * Response { order_id, invoice_id, invoice_url, status }
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/nowpayments.php';
require_once __DIR__ . '/../lib/dispatch.php';

$config = load_config();
apply_cors($config);
require_method('POST');

if (!nowpayments_is_configured($config)) {
    json_error(
        'Crypto payments are not configured yet. Add your NOWPayments API key to server/api/config.php.',
        503,
        'GATEWAY_NOT_CONFIGURED'
    );
}

$body = read_json_body();

$orderId = clean_str($body['orderId'] ?? '', 96);
$priceUsd = round((float) ($body['priceUsd'] ?? 0), 2);
$description = clean_str($body['description'] ?? 'Digital goods order', 200);
$successUrl = clean_str($body['successUrl'] ?? '', 300);
$cancelUrl = clean_str($body['cancelUrl'] ?? '', 300);
// Cart lines, used later to claim stock.
$items = dispatch_normalise_items($body['items'] ?? []);
$buyerEmail = clean_str($body['buyerEmail'] ?? '', 190);

if ($orderId === '') {
    json_error('orderId is required.', 422, 'MISSING_ORDER_ID');
}
if ($priceUsd <= 0) {
    json_error('priceUsd must be greater than zero.', 422, 'INVALID_AMOUNT');
}

$existing = store_read_order($config, $orderId);
$order = array_merge($existing ?? [], [
    'order_id' => $orderId,
    'order_token' => (string) ($existing['order_token'] ?? new_order_token()),
    'items' => $items,
    'buyer_email' => $buyerEmail !== '' ? $buyerEmail : ($existing['buyer_email'] ?? null),
    'gateway' => 'nowpayments',
    'amount_usd' => $priceUsd,
    'currency' => 'USD',
    'status' => 'pending',
]);

if (!store_write_order($config, $order)) {
    json_error('Could not record the order. Check that the data directory is writable.', 500, 'STORE_WRITE_FAILED');
}

$result = nowpayments_create_invoice($config, [
    'order_id' => $orderId,
    'price_usd' => $priceUsd,
    'description' => $description,
    'success_url' => $successUrl,
    'cancel_url' => $cancelUrl,
]);

store_log($config, 'nowpayments.create_invoice', [
    'order_id' => $orderId,
    'amount_usd' => $priceUsd,
    'ok' => $result['ok'],
    'error_code' => $result['errorCode'],
]);

if (!$result['ok']) {
    store_update_order($config, $orderId, [
        'status' => 'failed',
        'failure_reason' => $result['error'],
    ]);
    json_error($result['error'] ?? 'Could not create the invoice.', 400, $result['errorCode']);
}

$invoice = $result['data'] ?? [];

store_update_order($config, $orderId, [
    'nowpayments_invoice_id' => (string) ($invoice['id'] ?? ''),
    'invoice_url' => (string) ($invoice['invoice_url'] ?? ''),
]);

json_ok([
    'order_id' => $orderId,
    'order_token' => (string) (store_read_order($config, $orderId)['order_token'] ?? ''),
    'invoice_id' => (string) ($invoice['id'] ?? ''),
    'invoice_url' => (string) ($invoice['invoice_url'] ?? ''),
    'status' => 'pending',
]);
