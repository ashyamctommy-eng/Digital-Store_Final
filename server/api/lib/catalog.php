<?php
/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by scripts/sync-catalog.mjs from src/lib/products.ts, which is the
 * single source of truth for the catalog. Run `npm run sync:catalog` after
 * changing product delivery kinds or provider specs.
 *
 * The backend needs this because fulfilling an order on demand spends real
 * money, and must not depend on metadata sent by the browser.
 */

declare(strict_types=1);

/** product_id => on-demand provider spec, for delivery_kind "sms" products. */
const CATALOG_SMS_PRODUCTS = [
    'sms-whatsapp' => [
        'service_id' => 'wa',
        'country_id' => '2',
        'server_id' => '2',
        'label' => 'WhatsApp',
    ],
    'sms-telegram' => [
        'service_id' => 'tg',
        'country_id' => '2',
        'server_id' => '2',
        'label' => 'Telegram',
    ],
    'sms-facebook' => [
        'service_id' => 'fb',
        'country_id' => '2',
        'server_id' => '2',
        'label' => 'Facebook',
    ],
    'sms-google' => [
        'service_id' => 'go',
        'country_id' => '2',
        'server_id' => '2',
        'label' => 'Google',
    ],
    'sms-tiktok' => [
        'service_id' => 'lf',
        'country_id' => '2',
        'server_id' => '2',
        'label' => 'TikTok',
    ],
];

/** product_id => pool spec, for delivery_kind "proxy" products. */
const CATALOG_PROXY_PRODUCTS = [
    'proxy-9p-10' => [
        'per_unit' => 10,
        'label' => 'Static IPs',
    ],
    'proxy-mobile-02' => [
        'per_unit' => 5,
        'label' => 'Mobile IPs',
    ],
    'proxy-dc-03' => [
        'per_unit' => 25,
        'label' => 'Datacenter IPs',
    ],
];

/**
 * product_id => base price in USD.
 *
 * This exists so the SERVER can compute what an order costs. The browser sends
 * a price for display, but the checkout endpoints price the cart from this
 * table instead — otherwise a buyer could post amountUsd: 0.01 and have the
 * webhook confirm a payment that matched the price they chose themselves.
 *
 * Note KV pairs are reversed (JS needs quoting); PHP consts work the same way.
 */
const CATALOG_PRICES = [
    'fb-usa-01' => 51,
    'fb-uk-02' => 48.5,
    'fb-ng-03' => 29,
    'fb-de-04' => 50,
    'ig-5k-01' => 68.5,
    'ig-1k-02' => 40,
    'ig-aged-03' => 22.5,
    'tiktok-600' => 52,
    'tiktok-1k' => 81,
    'tiktok-mon-01' => 188.5,
    'sms-whatsapp' => 4.5,
    'sms-telegram' => 4.2,
    'sms-facebook' => 4.2,
    'sms-google' => 3.5,
    'sms-tiktok' => 3.5,
    'vpn-nord-1y' => 34.5,
    'vpn-surf-6m' => 20,
    'vpn-express-1y' => 47.5,
    'proxy-9p-10' => 46,
    'proxy-rot-01' => 26,
    'proxy-mobile-02' => 55.5,
    'proxy-dc-03' => 17,
];

/** The delivery kind recorded in the catalog, or null for an unknown product. */
function catalog_delivery_kind(string $productId): ?string
{
    if (isset(CATALOG_SMS_PRODUCTS[$productId])) {
        return 'sms';
    }
    if (isset(CATALOG_PROXY_PRODUCTS[$productId])) {
        return 'proxy';
    }
    return null;
}

/** True when a product is fulfilled as a phone number + inbox. */
function catalog_is_sms(string $productId): bool
{
    return isset(CATALOG_SMS_PRODUCTS[$productId]);
}

/** True when a product is fulfilled as an IP:PORT list. */
function catalog_is_proxy(string $productId): bool
{
    return isset(CATALOG_PROXY_PRODUCTS[$productId]);
}

/** The provider spec for an SMS product, or null. */
function catalog_sms_spec(string $productId): ?array
{
    return CATALOG_SMS_PRODUCTS[$productId] ?? null;
}

/** The pool spec for a proxy product, or null. */
function catalog_proxy_spec(string $productId): ?array
{
    return CATALOG_PROXY_PRODUCTS[$productId] ?? null;
}

/** Every SMS product id. */
function catalog_sms_product_ids(): array
{
    return array_keys(CATALOG_SMS_PRODUCTS);
}

/** Every proxy product id. */
function catalog_proxy_product_ids(): array
{
    return array_keys(CATALOG_PROXY_PRODUCTS);
}

/** Base price in USD for a product, or null when the product is unknown. */
function catalog_price_usd(string $productId): ?float
{
    return isset(CATALOG_PRICES[$productId]) ? (float) CATALOG_PRICES[$productId] : null;
}

/** Every product id the server can price. */
function catalog_product_ids(): array
{
    return array_keys(CATALOG_PRICES);
}
