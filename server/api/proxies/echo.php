<?php
/**
 * GET /api/proxies/echo
 *
 * A reflector. It reports what the request looked like when it arrived: the
 * client address and the forwarding headers a proxy would have added.
 *
 * The proxy checker sends a request THROUGH each proxy to this endpoint. That
 * tells us three things a third-party echo service cannot tell us as reliably:
 *
 *   - the exit IP a buyer's traffic would actually leave from;
 *   - whether our own address was forwarded along (i.e. whether the proxy is
 *     transparent, and would leak the buyer to the target site);
 *   - that the proxy really carried the request, rather than the client
 *     silently ignoring it.
 *
 * It is deliberately public and unauthenticated — a check has to work before the
 * buyer has proven anything, and the endpoint only ever echoes information back
 * to whoever called it. It stores nothing and reveals nothing about this server
 * beyond its own address.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';

$config = load_config();
apply_cors($config);
require_method('GET');

/** Headers that indicate a proxy inserted itself into the request. */
$forwardingHeaders = [
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-real-ip',
    'forwarded',
    'via',
    'proxy-connection',
    'x-proxy-id',
    'client-ip',
    'x-client-ip',
    'true-client-ip',
    'cf-connecting-ip',
    'x-originating-ip',
];

$seen = [];
foreach ($forwardingHeaders as $name) {
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (!empty($_SERVER[$key])) {
        $seen[$name] = clean_str((string) $_SERVER[$key], 400);
    }
}

// The address the request appeared to come from. REMOTE_ADDR is the socket
// peer, which is what matters: a proxy that forwards our real address in
// X-Forwarded-For but connects from its own IP still shows up as a leak, and
// REMOTE_ADDR keeps the two facts separable.
$remoteAddr = (string) ($_SERVER['REMOTE_ADDR'] ?? '');

json_ok([
    'ip' => $remoteAddr,
    'forwarded' => $seen,
    // Useful for debugging a check that fails for an unexpected reason.
    'user_agent' => clean_str((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 200),
    'method' => 'GET',
    'at' => gmdate('c'),
]);
