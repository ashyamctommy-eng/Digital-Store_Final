<?php
/**
 * IP:PORT primitives, shared by proxy stock parsing and the provider client.
 *
 * Both sides need to answer "is this a deliverable address?", and they must
 * agree: stock the admin pastes by hand and addresses bought from the provider
 * end up in the same list shown to the buyer.
 *
 * A proxy list is also an attack surface. Private, loopback, link-local and
 * reserved addresses are rejected outright — they would be useless to a buyer
 * and would let a bad paste or a compromised provider response point a
 * customer's traffic at internal hosts.
 */

declare(strict_types=1);

/**
 * True for routable public addresses only.
 *
 * `FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE` covers private space,
 * loopback, link-local and 240/4 — but it does NOT reject the documentation and
 * benchmark ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), carrier NAT
 * space, or multicast. Those are all unroutable from a customer's machine, so
 * an address in one of them would be sold and then fail immediately. They are
 * rejected explicitly.
 */
function proxy_public_ip(string $ip): bool
{
    $ip = trim($ip);
    if ($ip === '' || strlen($ip) > 45) {
        return false;
    }
    // Strip brackets from a bracketed IPv6 literal.
    if (str_starts_with($ip, '[') && str_ends_with($ip, ']')) {
        $ip = substr($ip, 1, -1);
    }

    $flags = FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;
    if (filter_var($ip, FILTER_VALIDATE_IP, $flags) === false) {
        return false;
    }

    // Unroutable IPv4 the filter above lets through.
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
        if (preg_match(
            '/^(?:0\.|100\.(?:6[4-9]|[7-9]\d|1[0-2]\d)\.|192\.0\.0\.|192\.0\.2\.'
            . '|198\.18\.|198\.19\.|198\.51\.100\.|203\.0\.113\.|22[4-9]\.|23\d\.)/',
            $ip
        ) === 1) {
            return false;
        }
        if ($ip === '255.255.255.255') {
            return false;
        }
    }

    return true;
}

/** Normalises a port to a string in range, or '' when unusable. */
function proxy_port($port): string
{
    if (!is_scalar($port)) {
        return '';
    }
    $digits = preg_replace('/\D+/', '', (string) $port) ?? '';
    if ($digits === '') {
        return '';
    }
    $number = (int) $digits;
    return ($number >= 1 && $number <= 65535) ? (string) $number : '';
}

/** "IP:PORT", or '' when the pair is not deliverable. */
function proxy_format_pair($ip, $port): string
{
    $ipString = is_scalar($ip) ? trim((string) $ip) : '';
    if (str_starts_with($ipString, '[') && str_ends_with($ipString, ']')) {
        $ipString = substr($ipString, 1, -1);
    }
    if (!proxy_public_ip($ipString)) {
        return '';
    }
    $portString = proxy_port($port);
    if ($portString === '') {
        return '';
    }
    // Re-bracket IPv6 so the result is unambiguously "host:port".
    if (str_contains($ipString, ':')) {
        return '[' . $ipString . ']:' . $portString;
    }
    return $ipString . ':' . $portString;
}

/** Validates and normalises an "IP:PORT" string. Returns '' when unusable. */
function proxy_normalize_address(string $value): string
{
    $value = trim($value);
    if ($value === '') {
        return '';
    }
    // Bracketed IPv6: [::1]:8080
    if (preg_match('/^(\[[0-9a-fA-F:]+\]):(\d{1,5})$/', $value, $m) === 1) {
        return proxy_format_pair($m[1], $m[2]);
    }
    // host:port — split on the LAST colon so a bare IPv6 without brackets still
    // has a chance of being read correctly.
    $position = strrpos($value, ':');
    if ($position === false) {
        return '';
    }
    return proxy_format_pair(substr($value, 0, $position), substr($value, $position + 1));
}

/**
 * Turns one entry of a provider payload into "IP:PORT".
 *
 * The documented field names are `ip` and `port`, but the shape is accepted
 * defensively: entries that are already "ip:port" strings, alternate field
 * names, nested wrappers and numeric ports all appear in the wild, and one
 * unreadable row must not fail an order.
 */
function proxy_format_entry($entry): string
{
    if (is_string($entry)) {
        return proxy_normalize_address($entry);
    }

    if (!is_array($entry)) {
        return '';
    }

    // Some payloads nest the address one level down.
    foreach (['proxy', 'node', 'address'] as $wrapper) {
        if (isset($entry[$wrapper]) && is_array($entry[$wrapper])) {
            $nested = proxy_format_entry($entry[$wrapper]);
            if ($nested !== '') {
                return $nested;
            }
        }
    }

    $ip = $entry['ip'] ?? $entry['host'] ?? $entry['server'] ?? $entry['address'] ?? '';
    $port = $entry['port'] ?? $entry['proxy_port'] ?? $entry['http_port'] ?? '';

    // An "ip:port" packed into one field.
    if (is_string($ip) && str_contains($ip, ':') && !is_scalar($port)) {
        return proxy_normalize_address($ip);
    }
    if (is_string($ip) && str_contains($ip, ':') && (string) $port === '') {
        return proxy_normalize_address($ip);
    }

    return proxy_format_pair($ip, $port);
}

/** Deduplicates a list of addresses, dropping anything unusable. */
function proxy_unique(array $list): array
{
    $out = [];
    $seen = [];
    foreach ($list as $entry) {
        $formatted = proxy_format_entry($entry);
        if ($formatted === '' || isset($seen[$formatted])) {
            continue;
        }
        $seen[$formatted] = true;
        $out[] = $formatted;
    }
    return $out;
}
