<?php
/**
 * Order dispatch: turn a paid order into delivered credentials.
 *
 * Runs once per order. Idempotent — a duplicate webhook returns the existing
 * deliverables instead of claiming more stock.
 */

declare(strict_types=1);

require_once __DIR__ . '/inventory.php';

/** Normalises the cart lines sent by the storefront. */
function dispatch_normalise_items(array $rawItems): array
{
    $items = [];
    foreach ($rawItems as $raw) {
        if (!is_array($raw)) {
            continue;
        }
        $productId = clean_str($raw['product_id'] ?? '', 96);
        if ($productId === '') {
            continue;
        }
        $items[] = [
            'product_id' => $productId,
            'name' => clean_str($raw['name'] ?? $productId, 160),
            'quantity' => max(1, (int) ($raw['quantity'] ?? 1)),
        ];
    }
    return $items;
}

/**
 * Claims stock for every line in a paid order and records the deliverables.
 *
 * @return array{deliverables:array, shortfall:array, already_dispatched:bool}
 */
function dispatch_order(array $config, string $orderId): array
{
    $order = store_read_order($config, $orderId);
    if ($order === null) {
        return ['deliverables' => [], 'shortfall' => [], 'already_dispatched' => false];
    }

    // Already delivered — return what the buyer got, never re-claim.
    if (!empty($order['dispatched_at'])) {
        return [
            'deliverables' => $order['deliverables'] ?? [],
            'shortfall' => $order['shortfall'] ?? [],
            'already_dispatched' => true,
        ];
    }

    $items = $order['items'] ?? [];
    if (!is_array($items) || !$items) {
        // Nothing to deliver (e.g. an order created before items were recorded).
        store_update_order($config, $orderId, [
            'dispatched_at' => gmdate('c'),
            'deliverables' => [],
            'shortfall' => [],
        ]);
        return ['deliverables' => [], 'shortfall' => [], 'already_dispatched' => false];
    }

    $deliverables = [];
    $shortfall = [];

    foreach ($items as $item) {
        $productId = (string) ($item['product_id'] ?? '');
        $qty = max(1, (int) ($item['quantity'] ?? 1));
        if ($productId === '') {
            continue;
        }

        $result = inventory_claim($config, $productId, $qty, $orderId);

        foreach ($result['units'] as $unit) {
            $deliverables[] = [
                'product_id' => $productId,
                'product_name' => (string) ($item['name'] ?? $productId),
                'uid' => $unit['uid'],
                'secret' => $unit['secret'],
            ];
        }

        if ($result['shortfall'] > 0) {
            $shortfall[$productId] = $result['shortfall'];
            store_log($config, 'dispatch.shortfall', [
                'order_id' => $orderId,
                'product_id' => $productId,
                'requested' => $qty,
                'delivered' => count($result['units']),
            ]);
        }
    }

    store_update_order($config, $orderId, [
        'deliverables' => $deliverables,
        'shortfall' => $shortfall,
        'dispatched_at' => gmdate('c'),
    ]);

    store_log($config, 'dispatch.completed', [
        'order_id' => $orderId,
        'units' => count($deliverables),
        'shortfall' => $shortfall,
    ]);

    return [
        'deliverables' => $deliverables,
        'shortfall' => $shortfall,
        'already_dispatched' => false,
    ];
}

/** Flat text rendering of an order's credentials, for downloads and email. */
function dispatch_render_text(array $order, array $deliverables, bool $includeToken = false): string
{
    $orderId = (string) ($order['order_id'] ?? '');
    $lines = [];
    $lines[] = '==============================================';
    $lines[] = '  DIGITAL HUB SHOP — ORDER ' . $orderId;
    $lines[] = '==============================================';
    $lines[] = '';
    if (!empty($order['created_at'])) {
        $lines[] = 'Date:    ' . $order['created_at'];
    }
    if (!empty($order['buyer_email'])) {
        $lines[] = 'Email:   ' . $order['buyer_email'];
    }
    if (!empty($order['currency'])) {
        $amount = $order['amount_kes'] ?? $order['amount_usd'] ?? null;
        if ($amount !== null) {
            $lines[] = 'Amount:  ' . $amount . ' ' . $order['currency'];
        }
    }
    $lines[] = '';

    if (!$deliverables) {
        $lines[] = 'No credentials are attached to this order yet.';
    } else {
        $current = null;
        foreach ($deliverables as $unit) {
            $name = (string) ($unit['product_name'] ?? $unit['product_id'] ?? '');
            if ($name !== $current) {
                $lines[] = '----------------------------------------------';
                $lines[] = $name;
                $lines[] = '----------------------------------------------';
                $current = $name;
            }
            $lines[] = ($unit['uid'] ?? '') . ' | ' . ($unit['secret'] ?? '');
        }
    }

    $lines[] = '';
    $lines[] = 'IMPORTANT';
    $lines[] = '- Log in from a clean IP and set the correct VPN location';
    $lines[] = '  before your first sign-in where the product requires it.';
    $lines[] = '- Do not change the password or recovery details for 24 hours.';
    $lines[] = '- Report any non-working credential within 24 hours for a';
    $lines[] = '  free replacement.';
    $lines[] = '';
    $lines[] = 'Support: see the contact links on our store.';
    $lines[] = 'Keep this file safe — it contains your credentials.';

    return implode(PHP_EOL, $lines) . PHP_EOL;
}
