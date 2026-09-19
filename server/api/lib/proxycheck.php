<?php
/**
 * Proxy checker.
 *
 * Sends a real request THROUGH each proxy to this site's own `/api/proxies/echo`
 * and grades what comes back. Nothing here trusts what a seller claimed about an
 * address: the protocol, the latency and the anonymity level are all measured.
 *
 * What each proxy is graded on:
 *
 *   health      the request completed inside the timeout
 *   speed       total round-trip milliseconds, banded
 *   anonymity   elite / anonymous / transparent, from the forwarding headers
 *               the echo endpoint received and whether our own address leaked
 *   type        which of HTTP(S), SOCKS5, SOCKS4 actually carried the request
 *   ip score    0-100 composite of the above, used to rank the list
 *
 * The IP score is our own heuristic. It says how well an address performs; it is
 * NOT a reputation or fraud score, and must not be described as one.
 *
 * Checking is bounded on purpose: a hard cap on how many proxies one request may
 * test, a bounded concurrency, and a per-attempt timeout. Without those, a pasted
 * list of a thousand dead addresses would hold a PHP worker for minutes.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/proxyaddr.php';

/** Protocol candidates, cheapest-to-verify first. */
function proxycheck_protocols(): array
{
    $map = [
        'http' => CURLPROXY_HTTP,
        'socks5' => CURLPROXY_SOCKS5,
        'socks4' => CURLPROXY_SOCKS4,
    ];
    // Remote-DNS variant is preferable when available: it avoids leaking the
    // target hostname through our own resolver.
    if (defined('CURLPROXY_SOCKS5_HOSTNAME')) {
        $map['socks5'] = CURLPROXY_SOCKS5_HOSTNAME;
    }
    return $map;
}

/** Maps a pasted scheme hint onto a protocol candidate list, hinted first. */
function proxycheck_protocol_order(string $schemeHint): array
{
    $all = array_keys(proxycheck_protocols());
    $hint = strtolower(trim($schemeHint));
    $hint = match ($hint) {
        'https', 'http', 'httpconnect' => 'http',
        'socks5', 'socks5h' => 'socks5',
        'socks4', 'socks4a' => 'socks4',
        default => '',
    };

    if ($hint === '' || !in_array($hint, $all, true)) {
        return $all;
    }
    return array_merge([$hint], array_values(array_diff($all, [$hint])));
}

/** Where the checker sends its requests. */
function proxycheck_echo_url(array $config): string
{
    $configured = trim((string) config_value($config, 'proxycheck.echo_url', ''));
    if ($configured !== '') {
        return $configured;
    }
    $base = rtrim((string) config_value($config, 'public_base_url', ''), '/');
    return $base . '/api/proxies/echo';
}

function proxycheck_timeout(array $config): int
{
    return max(2, (int) config_value($config, 'proxycheck.timeout_seconds', 8));
}

function proxycheck_concurrency(array $config): int
{
    return max(1, min(25, (int) config_value($config, 'proxycheck.concurrency', 10)));
}

/** Hard ceiling on how many addresses one request may test. */
function proxycheck_max(array $config, bool $isAdmin = false): int
{
    $key = $isAdmin ? 'proxycheck.max_admin' : 'proxycheck.max_buyer';
    $fallback = $isAdmin ? 100 : 50;
    return max(1, (int) config_value($config, $key, $fallback));
}

/**
 * The address this server goes out as, used to detect a leaking proxy.
 *
 * One direct request, once per run. Without it there is no way to tell
 * "the proxy forwarded a header" from "the proxy forwarded OUR address", and
 * that distinction is the whole difference between anonymous and transparent.
 */
function proxycheck_egress_ip(array $config): ?string
{
    $res = http_json_request('GET', proxycheck_echo_url($config), [], null, proxycheck_timeout($config));
    if ($res['error'] !== null || !is_array($res['body'])) {
        return null;
    }
    $ip = $res['body']['ip'] ?? null;
    return is_string($ip) && $ip !== '' ? $ip : null;
}

/**
 * Classifies anonymity from what the echo endpoint saw.
 *
 *   transparent — our own address was forwarded, so the target site would see
 *                 the real origin; the proxy hides nothing.
 *   anonymous   — forwarding headers arrived, but not our address.
 *   elite       — no forwarding headers at all, and a different exit address.
 */
function proxycheck_anonymity(?string $exitIp, array $forwarded, ?string $egressIp): string
{
    $values = array_map('strtolower', array_map('strval', $forwarded));
    $joined = implode(' ', $values);

    if ($egressIp !== null && $egressIp !== '') {
        if (str_contains($joined, strtolower($egressIp))) {
            return 'transparent';
        }
        // The proxy did not change our address at all.
        if ($exitIp !== null && strcasecmp($exitIp, $egressIp) === 0) {
            return 'transparent';
        }
    }

    if ($forwarded === []) {
        return $exitIp !== null && $exitIp !== '' ? 'elite' : 'unknown';
    }

    return 'anonymous';
}

/** Human band for a latency figure. */
function proxycheck_speed_band(?int $ms): string
{
    if ($ms === null) {
        return 'unreachable';
    }
    if ($ms <= 400) {
        return 'excellent';
    }
    if ($ms <= 800) {
        return 'good';
    }
    if ($ms <= 1500) {
        return 'fair';
    }
    return 'slow';
}

/**
 * Composite 0-100 score.
 *
 * health 10 + speed 35 + anonymity 35 + protocol 20. Deliberately blunt and
 * documented here so a customer-facing number has a definition behind it.
 */
function proxycheck_score(array $result): int
{
    if (empty($result['healthy'])) {
        return 0;
    }

    $score = 10;

    $ms = $result['latency_ms'];
    if (is_int($ms)) {
        $score += match (true) {
            $ms <= 400 => 35,
            $ms <= 800 => 28,
            $ms <= 1500 => 19,
            $ms <= 3000 => 10,
            default => 4,
        };
    }

    $score += match ($result['anonymity'] ?? 'unknown') {
        'elite' => 35,
        'anonymous' => 24,
        'transparent' => 5,
        default => 8,
    };

    $score += match ($result['protocol'] ?? '') {
        'socks5' => 20,
        'http' => 16,
        'socks4' => 12,
        default => 4,
    };

    return max(0, min(100, $score));
}

/** Letter grade for a score. */
function proxycheck_grade(int $score): string
{
    return match (true) {
        $score >= 80 => 'excellent',
        $score >= 65 => 'good',
        $score >= 45 => 'fair',
        default => 'poor',
    };
}

/**
 * Runs a curl_multi batch and returns each handle's outcome.
 *
 * @param array<int, array{handle:resource|CurlHandle, meta:array}> $jobs
 * @return array<int, array{status:int, body:string, error:string, total_ms:?int}>
 */
function proxycheck_run_batch(array $jobs, int $concurrency, int $timeout): array
{
    $multi = curl_multi_init();
    $active = [];
    $results = [];
    $queue = $jobs;

    // Fill the pool up to the concurrency limit, then replace each handle as it
    // finishes. Dead proxies fail on connect, so a large batch of them still
    // completes in roughly (count / concurrency) x timeout rather than series.
    $fill = static function () use (&$queue, &$active, $multi, $concurrency): void {
        while (count($active) < $concurrency && $queue) {
            $job = array_shift($queue);
            curl_multi_add_handle($multi, $job['handle']);
            $active[(int) $job['handle']] = $job;
        }
    };
    $fill();

    do {
        $status = curl_multi_exec($multi, $running);
        if ($running) {
            curl_multi_select($multi, 0.5);
        }

        while ($done = curl_multi_info_read($multi)) {
            $handle = $done['handle'];
            $key = (int) $handle;
            $job = $active[$key] ?? null;

            if ($job !== null) {
                $body = (string) curl_multi_getcontent($handle);
                $info = curl_getinfo($handle);
                $results[$job['meta']['index']] = [
                    'status' => (int) ($info['http_code'] ?? 0),
                    'body' => $body,
                    'error' => $done['result'] === CURLE_OK ? '' : (string) curl_strerror($done['result']),
                    'total_ms' => isset($info['total_time']) ? (int) round($info['total_time'] * 1000) : null,
                ];
            }

            curl_multi_remove_handle($multi, $handle);
            unset($active[$key]);
            $fill();
        }

        if (!$active && !$queue) {
            break;
        }
    } while ($running || $active || $queue);

    curl_multi_close($multi);
    return $results;
}

/**
 * Checks one batch of proxies.
 *
 * @param array $entries list of ['address'=>, 'username'=>, 'password'=>, 'scheme_hint'=>]
 * @return array{results:array, egress_ip:?string, error:?string}
 */
function proxycheck_many(array $config, array $entries, bool $isAdmin = false): array
{
    $echoUrl = proxycheck_echo_url($config);
    if (!preg_match('#^https?://#i', $echoUrl)) {
        return [
            'results' => [],
            'egress_ip' => null,
            'error' => 'proxycheck.echo_url (or public_base_url) is not an http(s) URL, so there is nothing to test against.',
        ];
    }

    $max = proxycheck_max($config, $isAdmin);
    $entries = array_slice(array_values($entries), 0, $max);
    if (!$entries) {
        return ['results' => [], 'egress_ip' => null, 'error' => 'No addresses to check.'];
    }

    $timeout = proxycheck_timeout($config);
    $concurrency = proxycheck_concurrency($config);
    $protocols = proxycheck_protocols();

    // Learn our own address once, so a leaking proxy can be told apart from one
    // that merely adds headers.
    $egressIp = proxycheck_egress_ip($config);

    // Ordered candidate list: the hinted protocol first, then the others.
    $candidates = [];
    foreach ($entries as $index => $entry) {
        $order = proxycheck_protocol_order((string) ($entry['scheme_hint'] ?? ''));
        $candidates[$index] = $order;
    }

    $outcomes = [];
    $remaining = array_keys($entries);

    // Try each protocol rank in rounds; a proxy drops out as soon as one works.
    $maxRounds = count($protocols);
    for ($round = 0; $round < $maxRounds && $remaining; $round++) {
        $jobs = [];
        $indexOf = [];
        foreach ($remaining as $index) {
            $name = $candidates[$index][$round] ?? null;
            if ($name === null || !isset($protocols[$name])) {
                continue;
            }
            $entry = $entries[$index];
            $handle = curl_init($echoUrl);
            $options = [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_CONNECTTIMEOUT => min($timeout, 6),
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_PROXY => $entry['address'],
                CURLOPT_PROXYTYPE => $protocols[$name],
                CURLOPT_HTTPHEADER => ['Accept: application/json'],
                CURLOPT_USERAGENT => 'DigitalHubShop-Checker/1.0',
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => 0,
            ];
            if (($entry['username'] ?? '') !== '') {
                $options[CURLOPT_PROXYUSERPWD] = $entry['username'] . ':' . ($entry['password'] ?? '');
            }
            curl_setopt_array($handle, $options);

            $jobs[] = ['handle' => $handle, 'meta' => ['index' => $index, 'protocol' => $name]];
            $indexOf[] = $index;
        }

        if (!$jobs) {
            break;
        }

        // Run this round, then keep only the proxies that failed.
        $batch = proxycheck_run_batch($jobs, $concurrency, $timeout);
        $stillFailing = [];

        foreach ($jobs as $job) {
            $index = $job['meta']['index'];
            $protocol = $job['meta']['protocol'];
            $res = $batch[$index] ?? null;

            $body = $res['body'] ?? '';
            $data = json_decode($body, true);
            $usable = ($res['status'] ?? 0) === 200 && is_array($data) && isset($data['ip']);

            if ($usable && !isset($outcomes[$index])) {
                $forwarded = is_array($data['forwarded'] ?? null) ? $data['forwarded'] : [];
                $exitIp = is_string($data['ip'] ?? null) ? $data['ip'] : null;
                $outcomes[$index] = [
                    'healthy' => true,
                    'protocol' => $protocol,
                    'exit_ip' => $exitIp,
                    'latency_ms' => $res['total_ms'] ?? null,
                    'forwarded' => $forwarded,
                    'anonymity' => proxycheck_anonymity($exitIp, $forwarded, $egressIp),
                    'error' => null,
                ];
            } else {
                $stillFailing[$index] = true;
                if (!isset($outcomes[$index])) {
                    $outcomes[$index] = [
                        'healthy' => false,
                        'protocol' => null,
                        'exit_ip' => null,
                        'latency_ms' => $res['total_ms'] ?? null,
                        'forwarded' => [],
                        'anonymity' => 'unknown',
                        'error' => ($res === null || ($res['error'] ?? '') === '')
                            ? 'No response through this address (timed out or refused).'
                            : $res['error'],
                    ];
                }
            }
        }

        $remaining = array_keys($stillFailing);
    }

    $results = [];
    foreach ($entries as $index => $entry) {
        $outcome = $outcomes[$index] ?? [
            'healthy' => false, 'protocol' => null, 'exit_ip' => null, 'latency_ms' => null,
            'forwarded' => [], 'anonymity' => 'unknown',
            'error' => 'Not checked.',
        ];
        $result = array_merge($entry, $outcome);

        // A refused connection returns in a millisecond, so a raw latency figure
        // would band an unreachable proxy as "excellent". Speed only means
        // anything once the address works.
        if (empty($result['healthy'])) {
            $result['latency_ms'] = null;
            $result['speed'] = 'unreachable';
        } else {
            $result['speed'] = proxycheck_speed_band($result['latency_ms']);
        }

        $result['score'] = proxycheck_score($result);
        $result['grade'] = proxycheck_grade($result['score']);
        $results[] = $result;
    }

    // Rank: best score first, then fastest, then the address for stability.
    usort($results, static function (array $a, array $b): int {
        return [$b['score'], $a['latency_ms'] ?? PHP_INT_MAX, $a['address']]
            <=> [$a['score'], $b['latency_ms'] ?? PHP_INT_MAX, $b['address']];
    });

    return ['results' => $results, 'egress_ip' => $egressIp, 'error' => null];
}

/** Summary counts for a checked batch. */
function proxycheck_summary(array $results): array
{
    $healthy = 0;
    $elite = 0;
    $latencies = [];
    foreach ($results as $r) {
        if (!empty($r['healthy'])) {
            $healthy++;
            if (($r['anonymity'] ?? '') === 'elite') {
                $elite++;
            }
            if (is_int($r['latency_ms'] ?? null)) {
                $latencies[] = $r['latency_ms'];
            }
        }
    }
    sort($latencies);

    return [
        'checked' => count($results),
        'healthy' => $healthy,
        'dead' => count($results) - $healthy,
        'elite' => $elite,
        'median_latency_ms' => $latencies ? $latencies[intdiv(count($latencies), 2)] : null,
        'best_score' => $results ? max(array_map(static fn ($r) => (int) $r['score'], $results)) : 0,
    ];
}
