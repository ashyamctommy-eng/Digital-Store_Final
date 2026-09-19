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
require_once __DIR__ . '/nextproxy.php';
require_once __DIR__ . '/proxyaddr.php';

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
 * Fulfils one proxy line, preferring stock we already own.
 *
 * Same shape as the SMS chain:
 *   1. pre-bought IP:PORT stock (already paid for);
 *   2. otherwise source addresses from the proxy provider;
 *   3. otherwise leave the remainder as a shortfall so the storefront shows
 *      Out of Stock instead of selling something we cannot deliver.
 *
 * One unit of a proxy product is worth `per_unit` addresses (the catalog says
 * "10 IPs", "25 IPs"), so both sources are counted in ADDRESSES here and only
 * chunked into units afterwards. Only whole units are delivered: a buyer who
 * paid for 10 addresses is never handed 7 because the pool ran dry — that
 * shows up as a shortfall instead.
 *
 * @return array{units:array, shortfall:int, dynamic_error:?string}
 */
function dispatch_claim_proxy(array $config, string $productId, int $qty, string $orderId): array
{
    $spec = catalog_proxy_spec($productId);
    if ($spec === null) {
        return ['units' => [], 'shortfall' => $qty, 'dynamic_error' => 'Product is not a proxy product.'];
    }

    $perUnit = max(1, (int) ($spec['per_unit'] ?? 1));

    // 1. Pre-bought stock. Count first so only whole units are claimed — a
    //    claim of 7 leftover addresses would be sold as a 10-IP product.
    $available = inventory_count_available($config, $productId);
    $staticUnits = min($qty, intdiv($available, $perUnit));

    $staticAddresses = [];
    if ($staticUnits > 0) {
        $claim = inventory_claim($config, $productId, $staticUnits * $perUnit, $orderId);
        foreach ($claim['units'] as $unit) {
            $address = (string) ($unit['proxy'] ?? $unit['uid'] ?? '');
            if ($address !== '') {
                $staticAddresses[] = $address;
            }
        }
    }

    $units = [];
    foreach (array_chunk($staticAddresses, $perUnit) as $chunk) {
        if (count($chunk) < $perUnit || count($units) >= $qty) {
            // A racing order shrank the pool between counting and claiming;
            // stop rather than deliver a partial unit.
            break;
        }
        $units[] = [
            'kind' => 'proxy',
            'source' => 'static',
            'product_id' => $productId,
            'uid' => $chunk[0],
            'secret' => implode(PHP_EOL, $chunk),
            'proxies' => array_values($chunk),
            'proxy_count' => count($chunk),
            'country' => strtoupper((string) ($spec['country'] ?? '')),
            'protocol' => (string) ($spec['protocol'] ?? ''),
            'notes' => '',
        ];
    }

    $remaining = $qty - count($units);
    if ($remaining <= 0) {
        return ['units' => $units, 'shortfall' => 0, 'dynamic_error' => null];
    }

    // 2. On-demand supply.
    if (!nextproxy_is_configured($config)) {
        return [
            'units' => $units,
            'shortfall' => $remaining,
            'dynamic_error' => 'The proxy provider is not enabled.',
        ];
    }

    $fetch = nextproxy_fetch(
        $config,
        $remaining * $perUnit,
        (string) ($spec['country'] ?? ''),
        (string) ($spec['protocol'] ?? '')
    );

    if (!$fetch['ok']) {
        return ['units' => $units, 'shortfall' => $remaining, 'dynamic_error' => $fetch['error']];
    }

    $meta = $fetch['meta'] ?? [];
    $dynamicError = null;
    $partial = 0;

    foreach (array_chunk($fetch['proxies'], $perUnit) as $chunk) {
        if (count($units) >= $qty) {
            break;
        }
        if (count($chunk) < $perUnit) {
            $partial = count($chunk);
            break;
        }
        $units[] = [
            'kind' => 'proxy',
            'source' => 'dynamic',
            'product_id' => $productId,
            'uid' => $chunk[0],
            'secret' => implode(PHP_EOL, $chunk),
            'proxies' => array_values($chunk),
            'proxy_count' => count($chunk),
            'country' => strtoupper((string) ($spec['country'] ?? '')),
            'protocol' => (string) ($spec['protocol'] ?? ''),
            // Recorded for support: a shared-pool batch can be replaced later.
            'pool_tier' => $meta['tier'] ?? null,
            'notes' => '',
        ];
    }

    $shortfall = max(0, $qty - count($units));
    if ($shortfall > 0) {
        $dynamicError = $fetch['error'] ?? ($partial > 0
            ? 'The provider pool returned an incomplete batch.'
            : 'The provider pool was smaller than requested.');
    }

    return ['units' => $units, 'shortfall' => $shortfall, 'dynamic_error' => $dynamicError];
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
        $kind = catalog_delivery_kind($productId);
        $result = match ($kind) {
            'sms' => dispatch_claim_sms($config, $productId, $qty, $orderId),
            'proxy' => dispatch_claim_proxy($config, $productId, $qty, $orderId),
            default => array_merge(inventory_claim($config, $productId, $qty, $orderId), ['dynamic_error' => null]),
        };

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

            if (($unit['kind'] ?? '') === 'proxy') {
                $proxies = is_array($unit['proxies'] ?? null) ? $unit['proxies'] : [];
                $lines[] = 'Proxies (' . count($proxies) . '):';
                foreach ($proxies as $proxy) {
                    $lines[] = '  ' . $proxy;
                }
                if (!empty($unit['country'])) {
                    $lines[] = 'Country: ' . $unit['country'];
                }
                if (!empty($unit['protocol'])) {
                    $lines[] = 'Protocol: ' . $unit['protocol'];
                }
                if (!empty($unit['notes'])) {
                    $lines[] = 'Notes:   ' . $unit['notes'];
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
