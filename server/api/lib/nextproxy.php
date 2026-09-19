<?php
/**
 * NextProxy client — on-demand proxy supply for `delivery_kind: "proxy"`.
 *
 * ---------------------------------------------------------------------------
 * What the provider actually does (verified against the live service, not just
 * its documentation — the two disagree, see DEVELOPER-NOTES.md):
 *
 *   GET {base}/api/proxies?format=json&limit=&country=&type=
 *   GET {base}/api/list?format=json&limit=&country=&key=
 *       Both routes return the same public pool and both accept either auth
 *       style. `/api/proxies` is the documented one.
 *
 *   Auth: `X-API-Key: <key>` header or `?key=<key>`. A key is OPTIONAL — the
 *   pool is served to unauthenticated callers. When a key IS supplied it is
 *   validated, and an invalid one fails the whole request with
 *   `{"status":"error","code":401,"message":"Invalid API key provided."}`.
 *
 *   Response:
 *       {
 *         "status": "success",
 *         "count": 2, "total": 82220, "page": 1, "limit": 2,
 *         "proxies": [
 *           { "ip": "2.59.132.39", "port": "3128", "type": "https",
 *             "protocol": "https", "country": "DE", "countryName": "Germany",
 *             "latency": 196, "anonymity": "anonymous", "status": "active",
 *             "isProOnly": false, "isLocked": false, "masked": false }
 *         ],
 *         "clientTier": "Guest Community Tier (60 req/min)"
 *       }
 *
 *   Quota: reported in headers, NOT in a body field and NOT at a profile
 *   endpoint. `/api/profile` and `/api/credits` both return 404, and the
 *   documented `X-Credits-Remaining` / `X-Credits-Used` headers do not appear
 *   in practice. What is actually sent is:
 *       x-ratelimit-limit: 60
 *       x-ratelimit-remaining: 48
 *       x-ratelimit-reset: <unix>
 *   So the "credits" the admin console shows come from those headers. If the
 *   account ever does expose a real credits endpoint, set
 *   `nextproxy.profile_path` and it is preferred.
 *
 * The pool is a shared, publicly-listed collection of mirrored proxies, not a
 * private allocation. Latency is high (150-250ms), anonymity is "anonymous"
 * rather than "elite", and the same address can be handed to other callers. The
 * admin console and docs say so plainly, because selling these as dedicated
 * residential or mobile IPs would misrepresent them.
 * ---------------------------------------------------------------------------
 *
 * Server-side only: the key must never reach the browser.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/proxyaddr.php';

const NEXTPROXY_DEFAULT_BASE = 'https://console.nextproxy.site';
const NEXTPROXY_DEFAULT_PATH = '/api/proxies';

/** Resolution order: admin-saved setting, then config.php, then environment. */
function nextproxy_api_key(array $config): string
{
    $fromSettings = settings_get($config, 'nextproxy.api_key', null);
    if (is_string($fromSettings) && trim($fromSettings) !== '') {
        return trim($fromSettings);
    }

    $fromConfig = trim((string) config_value($config, 'nextproxy.api_key', ''));
    if ($fromConfig !== '') {
        return $fromConfig;
    }

    $env = getenv('NEXTPROXY_API_KEY');
    return is_string($env) ? trim($env) : '';
}

/** Where the active key came from, for the admin console to report honestly. */
function nextproxy_key_source(array $config): string
{
    $fromSettings = settings_get($config, 'nextproxy.api_key', null);
    if (is_string($fromSettings) && trim($fromSettings) !== '') {
        return 'settings';
    }
    if (trim((string) config_value($config, 'nextproxy.api_key', '')) !== '') {
        return 'config';
    }
    $env = getenv('NEXTPROXY_API_KEY');
    if (is_string($env) && trim($env) !== '') {
        return 'env';
    }
    return 'none';
}

function nextproxy_base(array $config): string
{
    $base = trim((string) config_value($config, 'nextproxy.api_base', NEXTPROXY_DEFAULT_BASE));
    if ($base === '') {
        $base = NEXTPROXY_DEFAULT_BASE;
    }
    return rtrim($base, '/');
}

function nextproxy_list_path(array $config): string
{
    $path = trim((string) config_value($config, 'nextproxy.list_path', NEXTPROXY_DEFAULT_PATH));
    return $path === '' ? NEXTPROXY_DEFAULT_PATH : $path;
}

/**
 * How the key is presented. Defaults to the header: a key in a query string
 * ends up in access logs, proxies and Referer headers for no benefit, and the
 * provider accepts both. `query` exists because the original integration spec
 * used `?key=`.
 */
function nextproxy_auth_style(array $config): string
{
    $style = strtolower(trim((string) config_value($config, 'nextproxy.auth_style', 'header')));
    return in_array($style, ['header', 'query', 'both'], true) ? $style : 'header';
}

/**
 * Whether on-demand proxy supply has been switched on.
 *
 * Defaults to OFF, which is deliberate. The provider needs no key, so a default
 * of "on" would mean any store that never configured it would start sourcing
 * customer addresses from an unvetted third party — and only find out from an
 * order. Fulfilment has to be explicit about where stock comes from, so the
 * integration is opt-in: config.sample.php sets `enabled => true` for anyone
 * following the setup guide.
 */
function nextproxy_enabled(array $config): bool
{
    return (bool) config_value($config, 'nextproxy.enabled', false);
}

/**
 * Whether the store can source proxies at all.
 *
 * Deliberately does NOT require a key: the provider serves its pool publicly,
 * so demanding one would disable a working integration. `nextproxy.enabled`
 * remains the off switch.
 */
function nextproxy_is_configured(array $config): bool
{
    return nextproxy_enabled($config) && nextproxy_base($config) !== '';
}

/** Largest page the provider will return per request, and our paging ceiling. */
function nextproxy_batch_size(array $config): int
{
    $size = (int) config_value($config, 'nextproxy.max_batch', 100);
    return max(1, min(2500, $size));
}

/* -------------------------------------------------------------------------
 * Parsing
 * ---------------------------------------------------------------------- */

/**
 * Extracts every usable "IP:PORT" from a response body.
 *
 * Looks at the documented top-level `proxies` array first, then at the
 * plausible wrappers other revisions use.
 */
function nextproxy_parse_proxies(array $body): array
{
    $list = null;

    if (isset($body['proxies']) && is_array($body['proxies'])) {
        $list = $body['proxies'];
    } elseif (isset($body['data']['proxies']) && is_array($body['data']['proxies'])) {
        $list = $body['data']['proxies'];
    } elseif (isset($body['list']) && is_array($body['list'])) {
        $list = $body['list'];
    } elseif (isset($body['data']) && is_array($body['data']) && array_is_list($body['data'])) {
        $list = $body['data'];
    }

    if ($list === null) {
        return [];
    }

    $usable = [];
    foreach ($list as $entry) {
        // A masked or locked row is not a usable address, whatever else it says.
        if (is_array($entry) && (!empty($entry['masked']) || !empty($entry['isLocked']))) {
            continue;
        }
        $usable[] = $entry;
    }

    // proxy_unique() validates and deduplicates using the same rules the stock
    // parser applies, so both sources produce identical address strings.
    return proxy_unique($usable);
}

/**
 * Quota and pool metadata, taken from the response headers and body.
 *
 * The provider's documented credit headers are read as well: if they ever
 * start being sent, they win over the rate-limit counters.
 */
function nextproxy_meta_from_response(array $res): array
{
    $headers = is_array($res['headers'] ?? null) ? $res['headers'] : [];
    $body = is_array($res['body'] ?? null) ? $res['body'] : [];

    $int = static function (string $key) use ($headers): ?int {
        $raw = $headers[$key] ?? null;
        return is_numeric($raw) ? (int) $raw : null;
    };

    $creditsRemaining = $int('x-credits-remaining');
    $creditsUsed = $int('x-credits-used');

    return [
        // Documented but, as of writing, never actually sent.
        'credits_remaining' => $creditsRemaining,
        'credits_used' => $creditsUsed,
        // What the provider really sends.
        'rate_limit' => $int('x-ratelimit-limit'),
        'rate_remaining' => $int('x-ratelimit-remaining'),
        'rate_reset' => $int('x-ratelimit-reset'),
        'tier' => isset($body['clientTier']) && is_string($body['clientTier']) ? $body['clientTier'] : null,
        'pool_total' => isset($body['total']) && is_numeric($body['total'])
            ? (int) $body['total']
            : (isset($body['totalMatching']) && is_numeric($body['totalMatching']) ? (int) $body['totalMatching'] : null),
    ];
}

/* -------------------------------------------------------------------------
 * Requests
 * ---------------------------------------------------------------------- */

/**
 * Performs one list request.
 *
 * @return array{ok:bool, proxies:array, meta:array, error:?string, http:int, status:?string}
 */
function nextproxy_call(
    array $config,
    int $limit,
    string $countryCode = '',
    string $protocol = '',
    ?string $path = null
): array {
    $limit = max(1, $limit);
    $query = [
        'format' => 'json',
        'limit' => $limit,
    ];

    $country = strtoupper(trim($countryCode));
    if ($country !== '' && $country !== 'ALL') {
        $query['country'] = $country;
    }

    $proto = strtolower(trim($protocol));
    if ($proto !== '' && $proto !== 'all') {
        // The provider accepts `type` or `protocol`.
        $query['type'] = $proto;
    }

    $key = nextproxy_api_key($config);
    $style = nextproxy_auth_style($config);

    $headers = [];
    if ($key !== '' && ($style === 'header' || $style === 'both')) {
        $headers['X-API-Key'] = $key;
    }
    if ($key !== '' && ($style === 'query' || $style === 'both')) {
        $query['key'] = $key;
    }

    $url = nextproxy_base($config) . ($path ?? nextproxy_list_path($config))
        . '?' . http_build_query($query);

    $timeout = (int) config_value($config, 'nextproxy.timeout_seconds', 20);
    $res = http_json_request('GET', $url, $headers, null, max(5, $timeout));

    if ($res['error'] !== null) {
        return [
            'ok' => false,
            'proxies' => [],
            'meta' => [],
            'error' => 'Could not reach the proxy provider: ' . $res['error'],
            'http' => 0,
            'status' => null,
        ];
    }

    $body = $res['body'];
    if (!is_array($body)) {
        return [
            'ok' => false,
            'proxies' => [],
            'meta' => nextproxy_meta_from_response($res),
            'error' => 'The proxy provider returned an unreadable response (HTTP ' . $res['status'] . ').',
            'http' => $res['status'],
            'status' => null,
        ];
    }

    $status = isset($body['status']) && is_string($body['status']) ? strtolower($body['status']) : null;

    // Failures arrive as HTTP 401/403/402 with `status: "error"` and a message.
    if ($status === 'error' || isset($body['error'])) {
        $message = $body['message'] ?? $body['error'] ?? 'The proxy provider rejected the request.';
        return [
            'ok' => false,
            'proxies' => [],
            'meta' => nextproxy_meta_from_response($res),
            'error' => is_string($message) ? $message : 'The proxy provider rejected the request.',
            'http' => $res['status'],
            'status' => $status,
        ];
    }

    $meta = nextproxy_meta_from_response($res);
    $proxies = nextproxy_parse_proxies($body);

    if (!$proxies) {
        return [
            'ok' => false,
            'proxies' => [],
            'meta' => $meta,
            'error' => 'The proxy provider returned no usable addresses.',
            'http' => $res['status'],
            'status' => $status,
        ];
    }

    return [
        'ok' => true,
        'proxies' => $proxies,
        'meta' => $meta,
        'error' => null,
        'http' => $res['status'],
        'status' => $status,
    ];
}

/**
 * Fetches up to $qty proxies for a country and protocol.
 *
 * Pages through the provider when more than one batch is needed, and stops as
 * soon as it has enough. Returns fewer than asked for rather than failing —
 * the caller decides whether a short pool is a shortfall.
 *
 * @return array{ok:bool, proxies:array, meta:array, error:?string, http:int}
 */
function nextproxy_fetch(array $config, int $qty, string $countryCode = '', string $protocol = ''): array
{
    $qty = max(1, $qty);

    if (!nextproxy_is_configured($config)) {
        return [
            'ok' => false,
            'proxies' => [],
            'meta' => [],
            'error' => 'The proxy provider is not enabled.',
            'http' => 0,
        ];
    }

    // Never buy more than a single order could legitimately need.
    $ceiling = (int) config_value($config, 'nextproxy.max_per_order', 500);
    $qty = min($qty, max(1, $ceiling));

    $batch = nextproxy_batch_size($config);
    $collected = [];
    $seen = [];
    $meta = [];
    $error = null;
    $http = 0;

    while (count($collected) < $qty) {
        $want = (int) min($batch, $qty - count($collected));
        $res = nextproxy_call($config, $want, $countryCode, $protocol);
        $http = $res['http'];
        $meta = $res['meta'] ?: $meta;

        if (!$res['ok']) {
            $error = $res['error'];
            break;
        }

        $added = 0;
        foreach ($res['proxies'] as $proxy) {
            if (isset($seen[$proxy])) {
                continue;
            }
            $seen[$proxy] = true;
            $collected[] = $proxy;
            $added++;
            if (count($collected) >= $qty) {
                break;
            }
        }

        // A full page that yielded nothing new means further paging would loop.
        if ($added === 0 || count($res['proxies']) < $want) {
            break;
        }
    }

    if (!$collected) {
        return [
            'ok' => false,
            'proxies' => [],
            'meta' => $meta,
            'error' => $error ?? 'The proxy provider returned no usable addresses.',
            'http' => $http,
        ];
    }

    return [
        'ok' => true,
        'proxies' => array_slice($collected, 0, $qty),
        'meta' => $meta,
        // A partial result is still usable; the caller reports the shortfall.
        'error' => count($collected) < $qty ? ($error ?? 'The provider pool was smaller than requested.') : null,
        'http' => $http,
    ];
}

/* -------------------------------------------------------------------------
 * Admin status
 * ---------------------------------------------------------------------- */

/**
 * Optional credits/profile endpoint.
 *
 * Nothing like this exists on the provider today (`/api/profile` is a 404), so
 * it is opt-in: set `nextproxy.profile_path` if an account ever exposes one,
 * and its value is preferred over the rate-limit headers.
 */
function nextproxy_profile(array $config): array
{
    $path = trim((string) config_value($config, 'nextproxy.profile_path', ''));
    if ($path === '') {
        return ['ok' => false, 'credits' => null, 'error' => 'not_configured'];
    }

    $key = nextproxy_api_key($config);
    $query = [];
    $headers = [];
    $style = nextproxy_auth_style($config);
    if ($key !== '') {
        if ($style === 'header' || $style === 'both') {
            $headers['X-API-Key'] = $key;
        }
        if ($style === 'query' || $style === 'both') {
            $query['key'] = $key;
        }
    }

    $url = nextproxy_base($config) . $path;
    if ($query) {
        $url .= '?' . http_build_query($query);
    }

    $res = http_json_request('GET', $url, $headers, null, 15);
    if ($res['error'] !== null || !is_array($res['body'])) {
        return ['ok' => false, 'credits' => null, 'error' => $res['error'] ?? 'unreadable response'];
    }

    $body = $res['body'];
    $meta = nextproxy_meta_from_response($res);

    // Look in the body first, then in the headers.
    $candidates = [
        $body['credits_remaining'] ?? null,
        $body['creditsRemaining'] ?? null,
        $body['credits'] ?? null,
        $body['data']['credits_remaining'] ?? null,
        $body['data']['credits'] ?? null,
        $meta['credits_remaining'],
    ];
    foreach ($candidates as $candidate) {
        if (is_numeric($candidate)) {
            return ['ok' => true, 'credits' => (int) $candidate, 'error' => null];
        }
    }

    return ['ok' => false, 'credits' => null, 'error' => 'No credit count in the profile response.'];
}

/**
 * A one-request probe of the provider, for the admin console badge.
 *
 * @return array{
 *   ok:bool, enabled:bool, reachable:bool, key_present:bool, key_masked:string,
 *   key_source:string, base:string, path:string, auth_style:string,
 *   tier:?string, pool_total:?int, rate_limit:?int, rate_remaining:?int,
 *   rate_reset:?int, credits_remaining:?int, credits_used:?int,
 *   credits_source:?string, sample:array, error:?string, checked_at:string
 * }
 */
function nextproxy_probe(array $config): array
{
    $key = nextproxy_api_key($config);
    $sampleCount = max(1, (int) config_value($config, 'nextproxy.status_sample', 3));

    $base = [
        'ok' => false,
        'enabled' => nextproxy_enabled($config),
        'reachable' => false,
        'key_present' => $key !== '',
        'key_masked' => settings_mask_secret($key),
        'key_source' => nextproxy_key_source($config),
        'base' => nextproxy_base($config),
        'path' => nextproxy_list_path($config),
        'auth_style' => nextproxy_auth_style($config),
        'tier' => null,
        'pool_total' => null,
        'rate_limit' => null,
        'rate_remaining' => null,
        'rate_reset' => null,
        'credits_remaining' => null,
        'credits_used' => null,
        'credits_source' => null,
        'sample' => [],
        'error' => null,
        'checked_at' => gmdate('c'),
    ];

    if (!$base['enabled']) {
        $base['error'] = 'On-demand proxy supply is switched off in config.';
        return $base;
    }

    $res = nextproxy_call($config, $sampleCount);

    if (!$res['ok']) {
        $base['error'] = $res['error'];
        // A 401 is a reachable provider with a rejected key, which is a
        // different problem from an outage and worth saying so.
        $base['reachable'] = $res['http'] > 0;
        return $base;
    }

    $meta = $res['meta'];
    $base['ok'] = true;
    $base['reachable'] = true;
    $base['tier'] = $meta['tier'] ?? null;
    $base['pool_total'] = $meta['pool_total'] ?? null;
    $base['rate_limit'] = $meta['rate_limit'] ?? null;
    $base['rate_remaining'] = $meta['rate_remaining'] ?? null;
    $base['rate_reset'] = $meta['rate_reset'] ?? null;
    $base['sample'] = array_slice($res['proxies'], 0, $sampleCount);

    // A real credits endpoint wins over the rate-limit counters when present.
    $profile = nextproxy_profile($config);
    if ($profile['ok']) {
        $base['credits_remaining'] = $profile['credits'];
        $base['credits_source'] = 'profile';
    } elseif ($meta['credits_remaining'] !== null) {
        $base['credits_remaining'] = $meta['credits_remaining'];
        $base['credits_source'] = 'header';
    }
    if ($meta['credits_used'] !== null) {
        $base['credits_used'] = $meta['credits_used'];
    }

    return $base;
}

/** Cached probe, so the admin console and stock counts do not hammer the provider. */
function nextproxy_status_cached(array $config, ?int $ttlSeconds = null): array
{
    if ($ttlSeconds === null) {
        $ttlSeconds = (int) config_value($config, 'nextproxy.status_cache_seconds', 300);
    }

    $path = store_data_dir($config) . '/nextproxy-status.json';

    if ($ttlSeconds > 0 && is_file($path)) {
        $raw = @file_get_contents($path);
        $cached = $raw === false ? null : json_decode($raw, true);
        if (is_array($cached) && isset($cached['at'], $cached['status']) && is_array($cached['status'])) {
            if (time() - (int) $cached['at'] < $ttlSeconds) {
                $status = $cached['status'];
                $status['cached'] = true;
                return $status;
            }
        }
    }

    $fresh = nextproxy_probe($config);

    $tmp = $path . '.tmp';
    if (@file_put_contents($tmp, json_encode(
        ['at' => time(), 'status' => $fresh],
        JSON_UNESCAPED_SLASHES
    ), LOCK_EX) !== false) {
        @rename($tmp, $path);
        @chmod($path, 0640);
    }

    $fresh['cached'] = false;
    return $fresh;
}

/**
 * Whether on-demand proxy supply can currently deliver.
 *
 * The storefront uses this to decide between "On Demand" and "Out of Stock", so
 * it must reflect a provider that is actually answering.
 */
function nextproxy_can_dispatch(array $config): bool
{
    if (!nextproxy_is_configured($config)) {
        return false;
    }
    return (bool) (nextproxy_status_cached($config)['ok'] ?? false);
}
