<?php
/**
 * Server-side order pricing.
 *
 * THE RULE: the price of an order is computed here, from the catalog, and never
 * taken from the request body.
 *
 * Why this file exists
 * --------------------
 * The checkout endpoints used to accept the amount from the browser
 * (`amountKes` / `priceUsd`) and store it on the order. The Palplus webhook
 * then cross-checked the settled amount against the order's stored amount — but
 * both numbers traced back to the same client-supplied value, so the check
 * compared a number with itself. A buyer could post `amountKes: 1`, pay one
 * shilling, and the "guard against a tampered amount" would pass and dispatch
 * the goods. NOWPayments had no amount check at all.
 *
 * The catalog is generated from `src/lib/products.ts` into `lib/catalog.php` and
 * is the server's own copy of every price, so the correct total is always
 * available without trusting the browser.
 */

declare(strict_types=1);

require_once __DIR__ . '/catalog.php';
require_once __DIR__ . '/http.php';

/**
 * Rounding difference we forgive between the browser's total and ours, in cents.
 *
 * The comparison is done in whole cents rather than with a float tolerance:
 * `abs(100.00 - 100.01)` evaluates to 0.010000000000005, which is GREATER than
 * 0.01, so a `<= 0.01` test rejects a difference that is exactly one cent.
 * Rounding both sides to cents first is exact and still forgives the noise from
 * summing the same cart in a different order.
 */
const PRICING_TOLERANCE_CENTS = 0;

/** 1 USD = N KES. Overridable from the Configurations console. */
function pricing_fx_rate(array $config): float
{
    $rate = (float) config_value($config, 'fx_rate_kes', 130);
    return $rate > 0 ? $rate : 130.0;
}

/**
 * Sums a cart at catalog prices, before rounding.
 *
 * Kept separate because the KES charge must be derived from the exact sum: the
 * browser converts the unrounded total, so rounding to cents first and then
 * multiplying by the rate can land a shilling away.
 *
 * @param list<array{product_id:string,quantity:int}> $items normalised items
 * @return float|null USD total, or null when any product is unknown to the
 *                    catalog — the caller must refuse rather than guess.
 */
function pricing_total_usd_exact(array $items): ?float
{
    if ($items === []) {
        return null;
    }

    $total = 0.0;
    foreach ($items as $item) {
        $price = catalog_price_usd((string) ($item['product_id'] ?? ''));
        if ($price === null) {
            return null;
        }
        $total += $price * max(1, (int) ($item['quantity'] ?? 1));
    }

    return $total;
}

/** The cart total in USD, rounded to whole cents for storage. */
function pricing_total_usd(array $items): ?float
{
    $exact = pricing_total_usd_exact($items);
    return $exact === null ? null : round($exact, 2);
}

/** The same total expressed in whole KES, using the configured rate. */
function pricing_total_kes(array $config, array $items): ?int
{
    $exact = pricing_total_usd_exact($items);
    return $exact === null ? null : (int) round($exact * pricing_fx_rate($config));
}

/**
 * True when the amount the browser displayed is close enough to ours to charge.
 *
 * The browser and PHP round the same cart independently and floating point
 * sums are order-dependent, so an exact match is the wrong test: it would fail
 * legitimate checkouts over a single shilling. A difference beyond rounding,
 * though, means either a tampered request or a price that changed while the
 * customer was on the page. Both should stop the sale, not silently re-price it.
 */
function pricing_amounts_agree(float $client, float $server): bool
{
    $difference = abs((int) round($client * 100) - (int) round($server * 100));
    return $difference <= PRICING_TOLERANCE_CENTS;
}

/**
 * Adds the catalog price to each line, for storage on the order.
 *
 * An order record should say what each line cost at the time of sale. The
 * ledger previously stored only a product id and a quantity, so a later price
 * change made old orders impossible to audit — and the admin screen had no
 * figure to show per line. Unknown products are left at 0 rather than guessed.
 *
 * @param list<array> $items normalised items
 * @return list<array> items with `price_usd` and `line_usd` added
 */
function pricing_describe_items(array $items): array
{
    $out = [];
    foreach ($items as $item) {
        $price = catalog_price_usd((string) ($item['product_id'] ?? '')) ?? 0.0;
        $quantity = max(1, (int) ($item['quantity'] ?? 1));
        $item['price_usd'] = $price;
        $item['line_usd'] = round($price * $quantity, 2);
        $out[] = $item;
    }
    return $out;
}

/**
 * Rejects a cart the server cannot price.
 *
 * @param list<array> $items normalised items
 */
function pricing_require_known_products(array $items): void
{
    foreach ($items as $item) {
        if (catalog_price_usd((string) ($item['product_id'] ?? '')) === null) {
            json_error(
                'One of the items in this order is no longer available. Please refresh and try again.',
                422,
                'UNKNOWN_PRODUCT'
            );
        }
    }
}
