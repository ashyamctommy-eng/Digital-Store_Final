<?php
/**
 * POST /api/palplus/initiate
 *
 * Starts an M-Pesa STK push through Palplus and records the order in our
 * ledger. The Palplus API key never leaves this server.
 *
 * Request  { orderId, accountReference, amountKes, phone, transactionDesc, items }
 *
 * `amountKes` is treated as the amount the CUSTOMER WAS SHOWN, not as the price.
 * The charge is computed from the catalog (lib/pricing.php); the two must agree
 * within rounding, or the order is refused.
 * Response { order_id, transaction_id, status, message }
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/palplus.php';
require_once __DIR__ . '/../lib/dispatch.php';
require_once __DIR__ . '/../lib/pricing.php';

$config = load_config();
apply_cors($config);
require_method('POST');

if (!palplus_is_configured($config)) {
    json_error(
        'M-Pesa is not configured yet. Add your Palplus API key to server/api/config.php.',
        503,
        'GATEWAY_NOT_CONFIGURED'
    );
}

$body = read_json_body();

$orderId = clean_str($body['orderId'] ?? '', 96);
$accountRef = clean_str($body['accountReference'] ?? '', 12);
$clientAmountKes = (int) ($body['amountKes'] ?? 0);
$phoneRaw = clean_str($body['phone'] ?? '', 20);
$desc = clean_str($body['transactionDesc'] ?? 'Order payment', 13);
// Cart lines, used later to claim stock. Normalised so a malformed payload
// cannot inject a path or a negative quantity into the ledger.
$items = dispatch_normalise_items($body['items'] ?? []);
// Each line records the price it was sold at, so the order stays auditable
// after a catalog price change.
$items = pricing_describe_items($items);
$buyerEmail = clean_str($body['buyerEmail'] ?? '', 190);
// Unguessable token: the buyer needs it to read their credentials later.
// Generated once; an existing order keeps the token it already handed out.
$orderToken = new_order_token();

if ($orderId === '') {
    json_error('orderId is required.', 422, 'MISSING_ORDER_ID');
}
if ($accountRef === '') {
    json_error('accountReference is required.', 422, 'MISSING_ACCOUNT_REFERENCE');
}
if ($items === []) {
    json_error('This order has no items.', 422, 'EMPTY_CART');
}
pricing_require_known_products($items);

// The price is OURS. `amountKes` from the browser is only what the customer was
// shown, so it is a check on us, never a source of truth.
$amountKes = pricing_total_kes($config, $items);
if ($amountKes === null || $amountKes < 1) {
    json_error('Could not price this order. Please refresh and try again.', 422, 'PRICING_FAILED');
}
if ($clientAmountKes > 0 && abs($clientAmountKes - $amountKes) > 1) {
    // Deliberate tampering, or the price changed while they were on the page.
    store_log($config, 'palplus.initiate.price_mismatch', [
        'order_id' => $orderId,
        'client_amount_kes' => $clientAmountKes,
        'server_amount_kes' => $amountKes,
    ]);
    json_error(
        'The order total changed. Please refresh the page and try again.',
        409,
        'PRICE_MISMATCH'
    );
}

$maxAmount = (int) config_value($config, 'max_kes_amount', 0);
if ($maxAmount > 0 && $amountKes > $maxAmount) {
    json_error('That amount exceeds the maximum this store accepts.', 422, 'AMOUNT_TOO_LARGE');
}

// Accept 07XXXXXXXX, 01XXXXXXXX, +254XXXXXXXXX, 254XXXXXXXXX.
$digits = digits_only($phoneRaw);
if (strlen($digits) === 10 && $digits[0] === '0') {
    $phone = '254' . substr($digits, 1);
} elseif (strlen($digits) === 9 && ($digits[0] === '7' || $digits[0] === '1')) {
    $phone = '254' . $digits;
} elseif (strlen($digits) === 12 && str_starts_with($digits, '254')) {
    $phone = $digits;
} else {
    json_error('Enter a valid Safaricom number, e.g. 0712345678.', 422, 'INVALID_PHONE');
}

$publicBase = rtrim((string) config_value($config, 'public_base_url', ''), '/');
if ($publicBase === '' || !str_starts_with($publicBase, 'https://')) {
    json_error(
        'public_base_url must be set to this site\'s public HTTPS URL before taking payments.',
        500,
        'CONFIG_INVALID'
    );
}

// Record the order before charging so the webhook always finds a match.
$existing = store_read_order($config, $orderId);
$order = array_merge($existing ?? [], [
    'order_token' => (string) ($existing['order_token'] ?? $orderToken),
    'items' => $items,
    'buyer_email' => $buyerEmail !== '' ? $buyerEmail : ($existing['buyer_email'] ?? null),
    'order_id' => $orderId,
    'account_reference' => $accountRef,
    'gateway' => 'palplus',
    'amount_kes' => $amountKes,
    'amount_usd' => pricing_total_usd($items),
    'currency' => 'KES',
    'phone' => $phone,
    'status' => 'pending',
]);

if (!store_write_order($config, $order)) {
    json_error('Could not record the order. Check that the data directory is writable.', 500, 'STORE_WRITE_FAILED');
}

$result = palplus_initiate_stk($config, [
    'amount' => $amountKes,
    'phone' => $phone,
    'account_reference' => $accountRef,
    'transaction_desc' => $desc,
    'callback_url' => $publicBase . '/api/palplus/webhook',
]);

store_log($config, 'palplus.initiate', [
    'order_id' => $orderId,
    'account_reference' => $accountRef,
    'amount_kes' => $amountKes,
    'ok' => $result['ok'],
    'status' => $result['status'],
    'error_code' => $result['errorCode'],
]);

if (!$result['ok']) {
    store_update_order($config, $orderId, [
        'status' => 'failed',
        'failure_reason' => $result['error'],
    ]);

    // 502 when the provider is unreachable, 4xx when it rejected us.
    $status = $result['status'] === 0 ? 502 : 400;
    json_error($result['error'] ?? 'Could not start the M-Pesa request.', $status, $result['errorCode']);
}

$data = $result['data'] ?? [];
$transactionId = (string) ($data['transactionId'] ?? '');

store_update_order($config, $orderId, [
    'palplus_transaction_id' => $transactionId,
    'palplus_status' => $data['status'] ?? 'PENDING',
    'provider_checkout_id' => $data['providerCheckoutId'] ?? null,
    'provider_request_id' => $data['providerRequestId'] ?? null,
]);

json_ok([
    'order_id' => $orderId,
    'order_token' => (string) (store_read_order($config, $orderId)['order_token'] ?? ''),
    'transaction_id' => $transactionId,
    'status' => palplus_map_status($data['status'] ?? 'PENDING'),
    'message' => $data['resultDescription'] ?? 'Payment request sent. Enter your M-Pesa PIN to complete the order.',
]);
