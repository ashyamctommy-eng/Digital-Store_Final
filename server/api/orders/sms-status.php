<?php
/**
 * GET /api/orders/sms-status?order_id=…&token=…
 *
 * Live inbox feed for an order's SMS numbers.
 *
 * Pre-bought numbers already carry an inbox link, so the answer is simply the
 * stored record. On-demand activations have no link — the code lives with the
 * provider — so this polls `otp/info` and caches the code onto the order the
 * first time it appears.
 *
 * Deliberately only ever reads from the provider: it must be safe to call this
 * on a timer from the Order Details page.
 *
 * Response { order_id, numbers: [ { uid, phone_number, inbox_url, notes,
 *            source, code, text, pending } ] }
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/smsotp.php';

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
    json_error('This link is not valid for that order.', 403, 'UNAUTHORIZED');
}

$deliverables = is_array($order['deliverables'] ?? null) ? $order['deliverables'] : [];
$numbers = [];
$changed = false;

foreach ($deliverables as $index => $unit) {
    if (($unit['kind'] ?? '') !== 'sms') {
        continue;
    }

    $entry = [
        'uid' => (string) ($unit['uid'] ?? ''),
        'phone_number' => (string) ($unit['phone_number'] ?? $unit['uid'] ?? ''),
        'inbox_url' => (string) ($unit['inbox_url'] ?? ''),
        'notes' => (string) ($unit['notes'] ?? ''),
        'source' => (string) ($unit['source'] ?? 'static'),
        'code' => $unit['code'] ?? null,
        'text' => $unit['text'] ?? null,
        'pending' => false,
    ];

    // On-demand numbers have no inbox link; ask the provider for the code.
    $isDynamic = $entry['source'] === 'dynamic';
    $smsPhoneId = (string) ($unit['sms_phone_id'] ?? '');

    if ($isDynamic && $smsPhoneId !== '' && empty($entry['code'])) {
        $info = smsotp_info($config, $smsPhoneId);
        if ($info['ok']) {
            if ($info['code'] !== null) {
                $deliverables[$index]['code'] = $info['code'];
                $deliverables[$index]['text'] = $info['text'];
                $deliverables[$index]['code_received_at'] = gmdate('c');
                $entry['code'] = $info['code'];
                $entry['text'] = $info['text'];
                $changed = true;
            } else {
                $entry['pending'] = true;
            }
        } else {
            // A provider hiccup must not look like a failure to the buyer.
            $entry['pending'] = true;
        }
    } elseif ($isDynamic && empty($entry['code'])) {
        $entry['pending'] = true;
    }

    $numbers[] = $entry;
}

if ($changed) {
    store_update_order($config, $orderId, ['deliverables' => $deliverables]);
    store_log($config, 'orders.sms_code_received', [
        'order_id' => $orderId,
        'numbers' => count($numbers),
    ]);
}

json_ok([
    'order_id' => $orderId,
    'status' => $order['status'] ?? 'pending',
    'numbers' => $numbers,
    'dynamic_supported' => smsotp_is_configured($config),
]);
