<?php
/**
 * A minimal HTTP forward proxy, for testing the proxy checker against real
 * traffic rather than a mocked outcome.
 *
 *   php -S is not usable here (it speaks the wrong protocol), so this is a raw
 *   stream_socket_server. Start it directly:
 *
 *       php tests/proxy-stub.php 127.0.0.1:8907
 *
 * It accepts the absolute-URI form a client sends to a proxy
 * (`GET http://host:port/path HTTP/1.1`), forwards the request, and returns the
 * response. A plain HTTP target is used so no CONNECT tunnelling is needed.
 *
 * A header controls how the proxy presents itself, which is what the checker's
 * anonymity classifier is judged on:
 *
 *   PROXY_STUB_MODE=elite        add nothing            -> elite
 *   PROXY_STUB_MODE=anonymous    add Via only           -> anonymous
 *   PROXY_STUB_MODE=transparent  leak an origin address -> transparent
 *
 * Every response also carries `X-Stub-Exit`, which tells the reflector stub which
 * exit address this proxy presents. Locally everything is 127.0.0.1, so without
 * it the checker could not tell "a different exit address" from "our own".
 *
 * `transparent` forwards PROXY_STUB_LEAK_IP (default 8.8.8.8, the reflector's
 * own baseline), i.e. it leaks the real origin — which is what makes it
 * transparent rather than anonymous.
 */

declare(strict_types=1);

$listen = $argv[1] ?? '127.0.0.1:8907';
$mode = getenv('PROXY_STUB_MODE') ?: 'elite';

$server = @stream_socket_server('tcp://' . $listen, $errno, $errstr);
if ($server === false) {
    fwrite(STDERR, "proxy stub: cannot listen on {$listen}: {$errstr}\n");
    exit(1);
}
fwrite(STDOUT, "proxy stub ({$mode}) listening on {$listen}\n");

while (true) {
    $client = @stream_socket_accept($server, 30);
    if ($client === false) {
        continue;
    }

    stream_set_timeout($client, 10);

    // Read the request head.
    $head = '';
    while (!str_contains($head, "\r\n\r\n")) {
        $chunk = fread($client, 1024);
        if ($chunk === false || $chunk === '') {
            break;
        }
        $head .= $chunk;
        if (strlen($head) > 65536) {
            break;
        }
    }

    if ($head === '') {
        fclose($client);
        continue;
    }

    $lines = explode("\r\n", $head);
    $requestLine = array_shift($lines) ?? '';
    $parts = preg_split('/\s+/', trim($requestLine));
    if (count($parts) < 2) {
        fwrite($client, "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
        fclose($client);
        continue;
    }
    [$method, $target] = $parts;

    $url = parse_url($target);
    if (!is_array($url) || empty($url['host'])) {
        fwrite($client, "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
        fclose($client);
        continue;
    }

    $scheme = strtolower((string) ($url['scheme'] ?? 'http'));
    $host = (string) $url['host'];
    $port = (int) ($url['port'] ?? ($scheme === 'https' ? 443 : 80));
    $path = (string) ($url['path'] ?? '/');
    if (!empty($url['query'])) {
        $path .= '?' . $url['query'];
    }

    $peerIp = 'unknown';
    $peer = @stream_socket_get_name($client, true);
    if (is_string($peer) && $peer !== '') {
        $peerIp = str_contains($peer, ']:') ? substr($peer, 1, strpos($peer, ']:') - 1) : explode(':', $peer)[0];
    }

    // Forward the client's own headers, minus hop-by-hop ones.
    $forward = [];
    foreach ($lines as $line) {
        if (!str_contains($line, ':')) {
            continue;
        }
        $name = strtolower(trim(explode(':', $line, 2)[0]));
        if (in_array($name, ['proxy-connection', 'connection', 'host', 'accept-encoding'], true)) {
            continue;
        }
        $forward[] = $line;
    }
    $forward[] = 'Host: ' . $host . ($port === 80 || $port === 443 ? '' : ':' . $port);
    $forward[] = 'Connection: close';

    // How this proxy presents itself — the thing under test.
    // Tell the reflector which exit address this proxy presents.
    $exitIp = getenv('PROXY_STUB_EXIT_IP') ?: '9.9.9.9';
    $forward[] = 'X-Stub-Exit: ' . $exitIp;

    if ($mode === 'anonymous') {
        $forward[] = 'Via: 1.1 stub-proxy';
    } elseif ($mode === 'transparent') {
        // Leak the origin address, as a transparent proxy does.
        $leak = getenv('PROXY_STUB_LEAK_IP') ?: '8.8.8.8';
        $forward[] = 'X-Forwarded-For: ' . $leak;
        $forward[] = 'Via: 1.1 stub-proxy';
    }

    $out = "{$method} {$path} HTTP/1.1\r\n" . implode("\r\n", $forward) . "\r\n\r\n";
    $remote = @stream_socket_client('tcp://' . $host . ':' . $port, $e, $es, 8);
    if ($remote === false) {
        fwrite($client, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
        fclose($client);
        continue;
    }
    stream_set_timeout($remote, 10);
    fwrite($remote, $out);

    $response = '';
    while (!feof($remote)) {
        $chunk = fread($remote, 8192);
        if ($chunk === false || $chunk === '') {
            break;
        }
        $response .= $chunk;
    }
    fclose($remote);

    if ($response === '') {
        fwrite($client, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
    } else {
        fwrite($client, $response);
    }
    fclose($client);
}
