<?php
/**
 * Stub of the NextProxy list API, for testing on-demand proxy supply without
 * calling the real service or depending on a third party being up.
 *
 * Run:  php -S 127.0.0.1:8906 tests/nextproxy-stub.php
 *
 * It mirrors what the live service actually does (verified against it):
 *   GET /api/proxies?format=json&limit=&country=&type=
 *   GET /api/list?format=json&limit=&country=&key=
 *       -> {status:"success", count, total, page, limit, proxies:[{ip,port,…}],
 *           clientTier}
 *   Auth: X-API-Key header or ?key=; optional, but a wrong key fails with
 *         {"status":"error","code":401,"message":"Invalid API key provided."}
 *   Quota: x-ratelimit-* headers, plus x-credits-remaining / x-credits-used
 *   when a key is supplied (the real service only sends those to authenticated
 *   callers).
 *
 * It also models the two behaviours that actually broke the client:
 *   - MASKING: a share of rows come back with the address replaced by "•",
 *     exactly as the live free tier does.
 *   - PAGINATION: `page` is an offset window, so a request must keep the same
 *     `limit` across pages or it re-reads rows it has already seen.
 *
 * Behaviour is driven by a JSON state file (path in NEXTPROXY_STUB_STATE) so a
 * test can shrink the pool, reject the key, simulate an outage, and assert how
 * many addresses were actually bought.
 */

declare(strict_types=1);

$statePath = getenv('NEXTPROXY_STUB_STATE') ?: sys_get_temp_dir() . '/nextproxy-stub.json';

function stub_state(string $path): array
{
    $defaults = [
        // Addresses the stub will hand out, in order.
        'pool' => [],
        // How many addresses to generate when `pool` is not set explicitly.
        'pool_size' => 60,
        'call_count' => 0,
        'addresses_served' => 0,
        // 'ok' | 'invalid_key' | 'outage' | 'error'
        'mode' => 'ok',
        'rate_limit' => 60,
        'rate_remaining' => 48,
        'tier' => 'Guest Community Tier (60 req/min)',
        // Mask every Nth row (0 = never), like the live free tier's
        // "185.68.•••.•••" rows. The client must skip these and keep paging.
        'mask_every' => 0,
        // Page size the real service would return per request.
        'page_size' => 100,
        // Observability for the tests.
        'last_page' => 0,
        'health_calls' => 0,
        'pages_requested' => 0,
        'credits_remaining' => 1000,
        // Credit headers are sent only to authenticated callers, exactly as the
        // live service does. Set false to model a provider that never sends them.
        'send_credit_headers' => true,
        // The most recent key the client sent, so a test can prove the stored
        // key is actually transmitted rather than merely saved.
        'last_key' => '',
        'last_auth' => '',
    ];
    if (!is_file($path)) {
        return $defaults;
    }
    $raw = @file_get_contents($path);
    $decoded = $raw === false ? null : json_decode($raw, true);
    return is_array($decoded) ? array_merge($defaults, $decoded) : $defaults;
}

function stub_save(string $path, array $state): void
{
    @file_put_contents($path, json_encode($state), LOCK_EX);
}

function stub_out(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Deterministic public-looking addresses for a given index.
 * Ranges are from TEST-NET-3-ish space but deliberately NOT private, so the
 * client's private-address filter is not what makes a test pass or fail.
 */
function stub_address(int $index): array
{
    $third = 1 + intdiv($index, 250);
    $fourth = 1 + ($index % 250);
    return ['ip' => '203.0.' . $third . '.' . $fourth, 'port' => (string) (8000 + ($index % 1000))];
}

$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$state = stub_state($statePath);

// `/api/health` is deliberately free on the real service: no credit headers and
// no addresses. It is what the storefront's availability check uses, so it must
// not cost anything here either — the tests assert that.
if ($path === '/api/health') {
    if ($state['mode'] === 'outage') {
        stub_out(['status' => 'unavailable'], 503);
    }
    $state['health_calls'] = ((int) ($state['health_calls'] ?? 0)) + 1;
    stub_save($statePath, $state);
    stub_out([
        'status' => 'healthy',
        'cluster' => 'NextProxy Anycast Edge',
        'uptime' => '100.00% SLA',
        'nodesOnline' => 82555,
        'timestamp' => gmdate('c'),
    ]);
}

// Only the list routes exist; anything else is a 404 like the real service.
if ($path !== '/api/proxies' && $path !== '/api/list') {
    stub_out(['error' => 'Endpoint not found'], 404);
}

if ($state['mode'] === 'outage') {
    stub_out(['status' => 'error', 'message' => 'Upstream unavailable'], 503);
}

// The key is optional, but validated when present — same as the real service.
$key = (string) ($_SERVER['HTTP_X_API_KEY'] ?? ($_GET['key'] ?? ''));
$state['last_key'] = $key;
$state['last_auth'] = isset($_SERVER['HTTP_X_API_KEY']) ? 'header' : ($key !== '' ? 'query' : 'none');
stub_save($statePath, $state);
$state = stub_state($statePath);
if ($key !== '' && ($state['mode'] === 'invalid_key' || $key === 'bad-key')) {
    stub_out(['status' => 'error', 'code' => 401, 'message' => 'Invalid API key provided.'], 401);
}

if ($state['mode'] === 'error') {
    stub_out(['status' => 'error', 'code' => 402, 'message' => 'Payment Required'], 402);
}

$state['call_count']++;
$limit = max(1, (int) ($_GET['limit'] ?? 100));
$page = max(1, (int) ($_GET['page'] ?? 1));
$country = strtoupper((string) ($_GET['country'] ?? ''));

$state['call_count']++;
$state['pages_requested']++;
$state['last_page'] = $page;

// A stable master pool, so `page` addresses a real offset window. The live
// service behaves this way: page 2 returns different rows, but only if the
// limit stays the same.
$pool = is_array($state['pool']) && $state['pool'] ? $state['pool'] : null;
if ($pool === null) {
    $size = max(0, (int) $state['pool_size']);
    $pool = [];
    for ($i = 0; $i < $size; $i++) {
        $address = stub_address($i);
        $pool[] = ['ip' => $address['ip'], 'port' => $address['port'], 'country' => 'DE'];
    }
}

$offset = ($page - 1) * $limit;
$window = array_slice($pool, $offset, $limit);
$state['addresses_served'] += count($window);

$maskEvery = max(0, (int) $state['mask_every']);
$proxies = [];
foreach ($window as $index => $entry) {
    $globalIndex = $offset + $index;
    // The live free tier masks a share of every page rather than failing, so a
    // full page can yield fewer usable addresses than were asked for.
    $masked = $maskEvery > 0 && ($globalIndex + 1) % $maskEvery === 0;

    $proxies[] = [
        'ip' => $masked ? '185.68.' . "\u{2022}\u{2022}\u{2022}" . '.' . "\u{2022}\u{2022}\u{2022}" : $entry['ip'],
        'port' => $masked ? "\u{2022}\u{2022}\u{2022}\u{2022}" : $entry['port'],
        'type' => 'https',
        'protocol' => (string) ($_GET['type'] ?? 'https'),
        'country' => $entry['country'] ?? ($country !== '' ? $country : 'DE'),
        'latency' => 180,
        'anonymity' => 'anonymous',
        'status' => 'active',
        'isProOnly' => false,
        'isLocked' => false,
        'masked' => $masked,
    ];
}

stub_save($statePath, $state);

header('X-RateLimit-Limit: ' . (int) $state['rate_limit']);
header('X-RateLimit-Remaining: ' . max(0, (int) $state['rate_remaining'] - $state['call_count']));
header('X-RateLimit-Reset: ' . (time() + 60));
// The real service sends these only when a key is supplied.
if ($key !== '' && !empty($state['send_credit_headers'])) {
    header('X-Credits-Remaining: ' . max(0, (int) $state['credits_remaining'] - $state['call_count']));
    header('X-Credits-Used: ' . $state['call_count']);
}

stub_out([
    'status' => 'success',
    'count' => count($proxies),
    'total' => count($pool),
    'page' => $page,
    'limit' => $limit,
    'totalPages' => (int) ceil(count($pool) / max(1, $limit)),
    'proxies' => $proxies,
    'clientTier' => (string) $state['tier'],
]);
