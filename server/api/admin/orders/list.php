<?php
/**
 * GET /api/admin/orders/list      (admin key required)
 *
 * The real order ledger, newest first. This is the same file store the payment
 * webhooks write to and fulfilment dispatches from — not a copy the browser
 * made. Admin screens must read this, or they are looking at a list a customer
 * could have forged.
 *
 * Query: ?status=paid  ?q=<order id | reference | email | phone>  ?limit=200
 *
 * Response { orders: [...], totals: { scanned, returned, truncated, counts } }
 */

declare(strict_types=1);

require_once __DIR__ . '/../../lib/http.php';
require_once __DIR__ . '/../../lib/store.php';

$config = load_config();
apply_cors($config);
require_method('GET');
require_admin($config);

$status = trim((string) ($_GET['status'] ?? ''));
if ($status !== '' && in_array($status, store_order_statuses(), true) === false) {
    json_error('Unknown status filter.', 422, 'INVALID_STATUS');
}

$search = substr(trim((string) ($_GET['q'] ?? '')), 0, 120);
$limit = (int) ($_GET['limit'] ?? 200);

$result = store_list_orders($config, $limit, $status, $search);

$counts = array_fill_keys(store_order_statuses(), 0);
$revenueUsd = 0.0;
foreach ($result['orders'] as $order) {
    $s = (string) ($order['status'] ?? 'pending');
    if (isset($counts[$s])) {
        $counts[$s]++;
    }
    if (in_array($s, ['paid', 'delivered'], true)) {
        $revenueUsd += (float) ($order['amount_usd'] ?? 0);
    }
}

json_ok([
    'orders' => $result['orders'],
    'totals' => [
        'scanned' => $result['scanned'],
        'returned' => count($result['orders']),
        'truncated' => $result['truncated'],
        'counts' => $counts,
        'revenue_usd' => round($revenueUsd, 2),
    ],
]);
