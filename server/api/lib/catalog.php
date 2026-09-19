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
        'country' => 'US',
        'protocol' => 'https',
        'per_unit' => 10,
        'label' => 'Static IPs',
    ],
    'proxy-mobile-02' => [
        'country' => 'US',
        'protocol' => 'socks5',
        'per_unit' => 5,
        'label' => 'Mobile IPs',
    ],
    'proxy-dc-03' => [
        'country' => '',
        'protocol' => 'https',
        'per_unit' => 25,
        'label' => 'Datacenter IPs',
    ],
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
