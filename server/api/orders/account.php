<?php
/**
 * GET /api/orders/account
 * Claim and list orders addressed to the verified email on the current account.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/store.php';

$config = load_config();
require_method('GET');
$user = customer_auth_current_user($config);
if ($user === null) {
    json_error('Sign in with a verified email account to view linked orders.', 401, 'AUTHENTICATION_REQUIRED');
}

$claimed = customer_auth_claim_email_orders($config, $user);
if (!$claimed['ok']) {
    $code = (string) ($claimed['error'] ?? 'STORAGE_UNAVAILABLE');
    $message = $code === 'ORDER_SCAN_LIMIT'
        ? 'There are too many orders to link in one request. Contact store support.'
        : 'Account orders are temporarily unavailable.';
    json_error($message, 503, $code);
}

$orders = [];
foreach ($claimed['order_ids'] as $orderId) {
    $order = store_read_order($config, (string) $orderId);
    if (
        $order === null
        || !customer_auth_account_owns_order($config, (string) $user['id'], (string) $orderId)
    ) {
        continue;
    }

    $items = [];
    foreach ((array) ($order['items'] ?? []) as $item) {
        if (!is_array($item)) {
            continue;
        }
        $items[] = [
            'product_id' => (string) ($item['product_id'] ?? ''),
            'name' => (string) ($item['product_name'] ?? $item['name'] ?? $item['product_id'] ?? 'Product'),
            'quantity' => max(0, (int) ($item['quantity'] ?? 0)),
        ];
    }

    $orders[] = [
        'order_id' => (string) ($order['order_id'] ?? $orderId),
        'status' => (string) ($order['status'] ?? 'pending'),
        'gateway' => (string) ($order['gateway'] ?? ''),
        'currency' => (string) ($order['currency'] ?? ''),
        'amount' => $order['amount_kes'] ?? $order['amount_usd'] ?? null,
        'created_at' => (string) ($order['created_at'] ?? ''),
        'delivered_at' => $order['dispatched_at'] ?? null,
        'items' => $items,
        'shortfall' => is_array($order['shortfall'] ?? null) ? $order['shortfall'] : [],
        'account_owned' => true,
    ];
}

usort(
    $orders,
    static fn (array $a, array $b): int =>
        strcmp((string) $b['created_at'], (string) $a['created_at'])
);

json_ok(['orders' => $orders]);
