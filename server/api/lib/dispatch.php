<?php
/**
 * Order dispatch: turn a paid order into delivered credentials.
 *
 * Runs once per order. Idempotent — a duplicate webhook returns the existing
 * deliverables instead of claiming more stock.
 */

declare(strict_types=1);

require_once __DIR__ . '/inventory.php';
require_once __DIR__ . '/catalog.php';
require_once __DIR__ . '/smsotp.php';

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
 * Fulfils one SMS line, preferring stock we already own.
 *
 * Priority, as specified:
 *   1. pre-bought static stock (PHONE | INBOX_URL_OR_NOTES);
 *   2. otherwise buy an on-demand activation, but only when the provider is
 *      configured AND holds a spendable balance;
 *   3. otherwise leave the remainder as a shortfall so the storefront shows
 *      Out of Stock instead of taking money it cannot fulfil.
 *
 * Buying on demand spends the store's real balance, so it only ever happens
 * after the order is paid.
 *
 * @return array{units:array, shortfall:int, dynamic_error:?string}
 */
function dispatch_claim_sms(array $config, string $productId, int $qty, string $orderId): array
{
    $units = [];
    $dynamicError = null;

    // 1. Static pre-bought stock first.
    $static = inventory_claim($config, $productId, $qty, $orderId);
    foreach ($static['units'] as $unit) {
        $units[] = [
            'kind' => 'sms',
            'source' => 'static',
            'product_id' => $productId,
            'uid' => (string) ($unit['phone'] ?? $unit['uid'] ?? ''),
            'secret' => (string) ($unit['secret'] ?? ''),
            'phone_number' => (string) ($unit['phone'] ?? $unit['uid'] ?? ''),
            'inbox_url' => (string) ($unit['inbox_url'] ?? ''),
            'notes' => (string) ($unit['notes'] ?? ''),
            'code' => null,
        ];
    }

    $remaining = $qty - count($units);
    if ($remaining <= 0) {
        return ['units' => $units, 'shortfall' => 0, 'dynamic_error' => null];
    }

    // 2. On-demand activation.
    $spec = catalog_sms_spec($productId);
    if ($spec === null || !smsotp_is_configured($config)) {
        return [
            'units' => $units,
            'shortfall' => $remaining,
            'dynamic_error' => $spec === null ? 'Product is not an SMS product.' : 'On-demand provider is not configured.',
        ];
    }

    $balance = smsotp_balance($config);
    $minimum = (float) config_value($config, 'smsotp.min_balance', 0.01);
    if (!$balance['ok'] || $balance['balance'] <= $minimum) {
        return [
            'units' => $units,
            'shortfall' => $remaining,
            'dynamic_error' => $balance['ok']
                ? 'On-demand balance is too low.'
                : ('On-demand balance unavailable: ' . (string) $balance['error']),
        ];
    }

    for ($i = 0; $i < $remaining; $i++) {
        $rent = smsotp_rent(
            $config,
            (string) $spec['service_id'],
            (string) $spec['country_id'],
            (string) ($spec['server_id'] ?? '1'),
            (string) ($spec['provider_id'] ?? '')
        );

        if (!$rent['ok']) {
            $dynamicError = (string) ($rent['error'] ?? 'The provider would not issue a number.');
            break;
        }

        $units[] = [
            'kind' => 'sms',
            'source' => 'dynamic',
            'product_id' => $productId,
            'uid' => (string) $rent['phone'],
            'secret' => (string) $rent['phone'],
            'phone_number' => (string) $rent['phone'],
            'inbox_url' => '',
            'notes' => 'On-demand activation'
                . ($rent['operator'] ? ' · ' . $rent['operator'] : ''),
            'sms_phone_id' => $rent['sms_phone_id'],
            'operator' => $rent['operator'],
            'code' => null,
        ];
    }

    return [
        'units' => $units,
        'shortfall' => max(0, $qty - count($units)),
        'dynamic_error' => $dynamicError,
    ];
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

        // The delivery kind comes from the generated server-side catalog, not
        // from the browser — fulfilment decides how money is spent.
        $result = catalog_is_sms($productId)
            ? dispatch_claim_sms($config, $productId, $qty, $orderId)
            : array_merge(inventory_claim($config, $productId, $qty, $orderId), ['dynamic_error' => null]);

        foreach ($result['units'] as $unit) {
            $deliverables[] = array_merge($unit, [
                'product_id' => $productId,
                'product_name' => (string) ($item['name'] ?? $productId),
                // Generic fields so credentials rendering keeps working.
                'uid' => $unit['uid'] ?? '',
                'secret' => $unit['secret'] ?? ($unit['uid'] ?? ''),
                'kind' => $unit['kind'] ?? 'credentials',
            ]);
        }

        if ($result['shortfall'] > 0) {
            $shortfall[$productId] = $result['shortfall'];
            store_log($config, 'dispatch.shortfall', [
                'order_id' => $orderId,
                'product_id' => $productId,
                'requested' => $qty,
                'delivered' => count($result['units']),
                'reason' => $result['dynamic_error'] ?? null,
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

            if (($unit['kind'] ?? '') === 'sms') {
                $lines[] = 'Number:  ' . ($unit['phone_number'] ?? $unit['uid'] ?? '');
                if (!empty($unit['inbox_url'])) {
                    $lines[] = 'Inbox:   ' . $unit['inbox_url'];
                }
                if (!empty($unit['notes'])) {
                    $lines[] = 'Notes:   ' . $unit['notes'];
                }
                if (!empty($unit['code'])) {
                    $lines[] = 'Code:    ' . $unit['code'];
                }
                $lines[] = '';
                continue;
            }

            $lines[] = ($unit['uid'] ?? '') . ' | ' . ($unit['secret'] ?? '');
        }
    }

    $lines[] = '';
    if (array_filter($deliverables, static fn ($u) => ($u['kind'] ?? '') === 'sms')) {
        $lines[] = 'SMS NUMBERS';
        $lines[] = '- Open the inbox link and keep the page open while you request';
        $lines[] = '  the code from the service.';
        $lines[] = '- Use a VPN in the number\'s country, otherwise the service may';
        $lines[] = '  reject it.';
        $lines[] = '- Request the code within a few minutes of the number being issued.';
        $lines[] = '';
    }

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
