<?php
/**
 * POST /api/admin/orders/status      (admin key required)
 *
 * Manual status override for an order — the escape hatch for a payment settled
 * outside the gateways, or a refund handled by hand.
 *
 * Body { orderId: string, status: "pending"|"paid"|"delivered"|"failed"|"refunded" }
 *
 * Deliberately does NOT dispatch stock. Fulfilment is driven by the webhook, so
 * marking an order paid here records the decision without duplicating units;
 * it must never be a way to mint free stock.
 */

declare(strict_types=1);

require_once __DIR__ . '/../../lib/http.php';
require_once __DIR__ . '/../../lib/store.php';

$config = load_config();
apply_cors($config);
require_method('POST');
require_admin($config);

$body = read_json_body();
$orderId = trim((string) ($body['orderId'] ?? ''));
$status = trim((string) ($body['status'] ?? ''));

if ($orderId === '') {
    json_error('orderId is required.', 422, 'MISSING_ORDER_ID');
}
if (in_array($status, store_order_statuses(), true) === false) {
    json_error('Unknown status.', 422, 'INVALID_STATUS');
}

$order = store_read_order($config, $orderId);
if ($order === null) {
    json_error('Order not found.', 404, 'ORDER_NOT_FOUND');
}

$previous = (string) ($order['status'] ?? '');
if ($previous === $status) {
    json_ok(['order_id' => $orderId, 'status' => $status, 'changed' => false]);
}

if (!store_update_order($config, $orderId, [
    'status' => $status,
    'status_source' => 'admin',
    'status_previous' => $previous,
])) {
    json_error('Could not update the order.', 500, 'STORE_WRITE_FAILED');
}

store_log($config, 'admin.order.status', [
    'order_id' => $orderId,
    'from' => $previous,
    'to' => $status,
]);

json_ok(['order_id' => $orderId, 'status' => $status, 'changed' => true, 'previous' => $previous]);
