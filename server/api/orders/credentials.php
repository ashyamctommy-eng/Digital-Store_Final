<?php
/**
 * GET /api/orders/credentials?order_id=…&token=…
 *
 * Returns the credentials attached to a paid order.
 *
 * Access model: every order gets a random 32-hex `order_token` when it is
 * created, returned only to the buyer's browser. The order id alone is not
 * enough, so an order id leaking (a screenshot, a support thread) does not
 * expose credentials.
 *
 * Response { order_id, status, currency, amount, delivered_at, credentials: [...], shortfall }
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/inventory.php';

$config = load_config();
apply_cors($config);
require_method('GET');

$orderId = clean_str($_GET['order_id'] ?? '', 96);
$token = clean_str($_GET['token'] ?? '', 64);

if ($orderId === '') {
    json_error('order_id is required.', 422, 'MISSING_ORDER_ID');
}

$order = store_read_order($config, $orderId);
if ($order === null) {
    json_error('Unknown order.', 404, 'ORDER_NOT_FOUND');
}

$expected = (string) ($order['order_token'] ?? '');
if ($expected === '' || $token === '' || !hash_equals($expected, $token)) {
    store_log($config, 'orders.credentials.denied', ['order_id' => $orderId]);
    json_error('This link is not valid for that order.', 403, 'UNAUTHORIZED');
}

$status = (string) ($order['status'] ?? 'pending');
$deliverables = is_array($order['deliverables'] ?? null) ? $order['deliverables'] : [];

json_ok([
    'order_id' => $orderId,
    'status' => $status,
    'gateway' => $order['gateway'] ?? null,
    'currency' => $order['currency'] ?? null,
    'amount' => $order['amount_kes'] ?? $order['amount_usd'] ?? null,
    'buyer_email' => $order['buyer_email'] ?? null,
    'created_at' => $order['created_at'] ?? null,
    'delivered_at' => $order['dispatched_at'] ?? null,
    'email_sent_at' => $order['email_sent_at'] ?? null,
    'shortfall' => $order['shortfall'] ?? [],
    'credentials' => array_map(
        static fn ($unit) => [
            'product_id' => $unit['product_id'] ?? '',
            'product_name' => $unit['product_name'] ?? ($unit['product_id'] ?? ''),
            // "credentials" (UID|Password|Email), "sms" (number + inbox) or
            // "proxy" (a list of IP:PORT addresses).
            'kind' => $unit['kind'] ?? 'credentials',
            'uid' => $unit['uid'] ?? '',
            // `secret` is the raw pasted line, i.e. UID|Password|Email.
            'account_data' => $unit['secret'] ?? '',
            // SMS-only fields.
            'phone_number' => $unit['phone_number'] ?? null,
            'inbox_url' => $unit['inbox_url'] ?? null,
            'notes' => $unit['notes'] ?? null,
            'source' => $unit['source'] ?? null,
            'sms_phone_id' => $unit['sms_phone_id'] ?? null,
            'operator' => $unit['operator'] ?? null,
            'code' => $unit['code'] ?? null,
            // Proxy-only fields.
            'proxies' => is_array($unit['proxies'] ?? null) ? array_values($unit['proxies']) : [],
            'proxy_count' => isset($unit['proxy_count']) ? (int) $unit['proxy_count'] : null,
            'proxy_country' => $unit['country'] ?? null,
            'proxy_protocol' => $unit['protocol'] ?? null,
            'pool_tier' => $unit['pool_tier'] ?? null,
        ],
        $deliverables
    ),
    'items' => $order['items'] ?? [],
]);
