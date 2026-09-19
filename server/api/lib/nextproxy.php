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
 *   Quota, measured against a live key:
 *
 *     - Signed requests DO get the documented credit headers:
 *           x-credits-remaining: 955
 *           x-credits-used: 45
 *       They are simply ABSENT for unauthenticated requests, which is how an
 *       earlier probe concluded — wrongly — that they were never sent.
 *     - Every request that returns proxy data costs 1 credit, whatever the
 *       limit: `limit=1` and `limit=100` both cost 1. Cost is per request.
 *     - `/api/health` is FREE (no credit headers, works with or without a key),
 *       which is why reachability checks use it rather than fetching addresses.
 *     - Both rate-limit and credit headers also come back:
 *           x-ratelimit-limit: 60
 *           x-ratelimit-remaining: 48
 *     - No credits/profile ROUTE exists. `/api/profile`, `/api/credits`,
 *       `/api/me` and `/api/account` all 404 even when authenticated, so
 *       `nextproxy.profile_path` stays empty and the headers are the source.
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
function nextproxy_parse_proxies(array $body, ?int &$rawCount = null): array
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
        $rawCount = 0;
        return [];
    }

    // How many rows the provider actually sent, before anything was filtered
    // out. Paging needs this: see nextproxy_fetch().
    $rawCount = count($list);

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
 * @return array{ok:bool, proxies:array, meta:array, error:?string, http:int, status:?string, raw_count:int}
 */
function nextproxy_call(
    array $config,
    int $limit,
    string $countryCode = '',
    string $protocol = '',
    ?string $path = null,
    int $page = 1
): array {
    $limit = max(1, $limit);
    $query = [
        'format' => 'json',
        'limit' => $limit,
    ];
    // The provider paginates: without an explicit page, every request returns
    // the same leading rows, which makes a second page look like a duplicate.
    if ($page > 1) {
        $query['page'] = $page;
    }

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
            'raw_count' => 0,
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
            'raw_count' => 0,
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
            'raw_count' => 0,
        ];
    }

    $meta = nextproxy_meta_from_response($res);
    $rawCount = 0;
    $proxies = nextproxy_parse_proxies($body, $rawCount);

    if (!$proxies) {
        return [
            'ok' => false,
            'proxies' => [],
            'meta' => $meta,
            'error' => 'The proxy provider returned no usable addresses.',
            'http' => $res['status'],
            'status' => $status,
            'raw_count' => $rawCount,
        ];
    }

    return [
        'ok' => true,
        'proxies' => $proxies,
        'meta' => $meta,
        'error' => null,
        'http' => $res['status'],
        'status' => $status,
        'raw_count' => $rawCount,
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
    $page = 1;
    // Bounds the work: a page that yields nothing new (or the provider running
    // out) ends the loop sooner, but a hostile response cannot spin forever.
    $maxPages = max(1, (int) config_value($config, 'nextproxy.max_pages', 12));

    // The page size must stay CONSTANT for the whole walk. A page is an offset
    // window, so shrinking it on later requests re-reads rows already seen:
    // asking for 25 then 5 makes "page 2" rows 6-10, which page 1 already
    // covered. That silently capped every order at one page.
    $pageSize = max(1, min($batch, $qty));

    while (count($collected) < $qty && $page <= $maxPages) {
        $res = nextproxy_call($config, $pageSize, $countryCode, $protocol, null, $page);
        $page++;
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

        // Stop only when the PROVIDER had nothing more to give.
        //
        // Two traps here, both hit against the live service:
        //   1. This provider MASKS a share of every page (rows arrive as
        //      "185.68.•••.•••"), so a full page legitimately yields fewer
        //      usable addresses than were asked for while 80,000 remain.
        //      Comparing the usable count stopped paging after one page.
        //   2. It paginates, so the same rows come back until `page` advances.
        //      Without that, every extra request looked like a duplicate pool.
        $rawCount = (int) ($res['raw_count'] ?? count($res['proxies']));
        if ($added === 0 || $rawCount < $pageSize) {
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
        'error' => count($collected) < $qty
            ? ($error ?? 'The provider pool did not yield enough usable addresses.')
            : null,
        'http' => $http,
    ];
}

/* -------------------------------------------------------------------------
 * Reachability
 * ---------------------------------------------------------------------- */

/**
 * Free liveness check.
 *
 * `/api/health` returns cluster status without handing over any addresses, so it
 * costs no credits — unlike `/api/proxies`, which costs one credit per call
 * whatever the limit. The storefront asks whether proxies are available on
 * every page load, so that check has to be the free one; spending a credit per
 * page view would drain a 1,000-credit key in days.
 *
 * @return array{ok:bool, nodes:?int, error:?string, checked:int}
 */
function nextproxy_health(array $config): array
{
    if (!nextproxy_is_configured($config)) {
        return ['ok' => false, 'nodes' => null, 'error' => 'not_configured', 'checked' => 0];
    }

    $path = trim((string) config_value($config, 'nextproxy.health_path', '/api/health'));
    if ($path === '') {
        $path = '/api/health';
    }

    $res = http_json_request(
        'GET',
        nextproxy_base($config) . $path,
        [],
        null,
        max(5, (int) config_value($config, 'nextproxy.timeout_seconds', 20))
    );

    if ($res['error'] !== null) {
        return ['ok' => false, 'nodes' => null, 'error' => 'Could not reach the proxy provider: ' . $res['error'], 'checked' => time()];
    }

    $body = is_array($res['body']) ? $res['body'] : null;
    $healthy = $res['status'] >= 200 && $res['status'] < 300
        && $body !== null
        && (!isset($body['status']) || in_array(strtolower((string) $body['status']), ['healthy', 'success', 'ok'], true));

    return [
        'ok' => $healthy,
        'nodes' => isset($body['nodesOnline']) && is_numeric($body['nodesOnline'])
            ? (int) $body['nodesOnline']
            : null,
        'error' => $healthy ? null : 'The proxy provider reported a problem (HTTP ' . $res['status'] . ').',
        'checked' => time(),
    ];
}

/** Cached free reachability check, used by the storefront. */
function nextproxy_health_cached(array $config, ?int $ttlSeconds = null): array
{
    if ($ttlSeconds === null) {
        $ttlSeconds = (int) config_value($config, 'nextproxy.health_cache_seconds', 600);
    }

    $path = store_data_dir($config) . '/nextproxy-health.json';

    if ($ttlSeconds > 0 && is_file($path)) {
        $raw = @file_get_contents($path);
        $cached = $raw === false ? null : json_decode($raw, true);
        if (is_array($cached) && isset($cached['at'], $cached['ok'])) {
            if (time() - (int) $cached['at'] < $ttlSeconds) {
                return [
                    'ok' => (bool) $cached['ok'],
                    'nodes' => isset($cached['nodes']) ? (int) $cached['nodes'] : null,
                    'error' => $cached['error'] ?? null,
                    'checked' => (int) $cached['at'],
                    'cached' => true,
                ];
            }
        }
    }

    $fresh = nextproxy_health($config);

    $tmp = $path . '.tmp';
    if (@file_put_contents($tmp, json_encode([
        'at' => time(),
        'ok' => $fresh['ok'],
        'nodes' => $fresh['nodes'],
        'error' => $fresh['error'],
    ], JSON_UNESCAPED_SLASHES), LOCK_EX) !== false) {
        @rename($tmp, $path);
        @chmod($path, 0o640);
    }

    $fresh['cached'] = false;
    return $fresh;
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
 * Costs ONE credit per call (the sample fetch), so it is cached for
 * `nextproxy.status_cache_seconds` and only refreshed on demand. Never call this
 * from a page-load path — use nextproxy_health_cached() for availability.
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
        $ttlSeconds = (int) config_value($config, 'nextproxy.status_cache_seconds', 1800);
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
 * The storefront uses this to decide between "On Demand" and "Out of Stock" on
 * every page load, so it deliberately uses the FREE health check rather than
 * the sampled probe: that one costs a credit, and a credit per page view would
 * empty a fresh key's balance within days.
 */
function nextproxy_can_dispatch(array $config): bool
{
    if (!nextproxy_is_configured($config)) {
        return false;
    }
    return (bool) (nextproxy_health_cached($config)['ok'] ?? false);
}
