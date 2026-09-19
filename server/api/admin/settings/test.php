<?php
/**
 * POST /api/admin/settings/test        (admin key required)
 *
 * "Does this credential actually work?" — asked against the live provider rather
 * than assumed. Pasting a key and hoping is how a store finds out at checkout
 * that its gateway was never configured.
 *
 * Request  { "integration": "palplus" | "nowpayments" | "resend" | "smsotp" | "proxycheck" }
 * Response { ok, integration, checks: [{ label, ok, detail }], error }
 *
 * Every check is read-only. Nothing here sends money, sends mail, or buys a
 * number — the one endpoint that spends anything is the SMS balance read, which
 * is free.
 */

declare(strict_types=1);

require_once __DIR__ . '/../../lib/http.php';
require_once __DIR__ . '/../../lib/store.php';
require_once __DIR__ . '/../../lib/settings.php';
require_once __DIR__ . '/../../lib/palplus.php';
require_once __DIR__ . '/../../lib/nowpayments.php';
require_once __DIR__ . '/../../lib/smsotp.php';
require_once __DIR__ . '/../../lib/email.php';
require_once __DIR__ . '/../../lib/proxycheck.php';

$config = load_config();
require_method('POST');
require_admin($config);

$body = read_json_body();
$integration = clean_str($body['integration'] ?? '', 32);

function check_row(string $label, bool $ok, ?string $detail = null): array
{
    return ['label' => $label, 'ok' => $ok, 'detail' => $detail];
}

$checks = [];
$error = null;

switch ($integration) {
    case 'palplus':
        if (!palplus_is_configured($config)) {
            $error = 'No Palplus API key is set yet.';
            break;
        }

        $wallet = palplus_service_wallet($config);
        $checks[] = check_row(
            'API key is accepted',
            $wallet['ok'] || $wallet['error'] !== null && $wallet['http'] !== 401,
            $wallet['http'] === 401 ? 'Palplus rejected the key (401 INVALID_API_KEY).' : null
        );

        // The wallet is what pays the per-transaction fee.
        $checks[] = check_row(
            'Service wallet balance is readable',
            $wallet['balance'] !== null,
            $wallet['balance'] !== null
                ? sprintf('%.2f %s available.', $wallet['balance'], (string) $wallet['currency'])
                : ($wallet['error'] ?? 'Could not read the balance.')
        );
        if ($wallet['balance'] !== null && $wallet['balance'] <= 0) {
            $checks[] = check_row(
                'Service wallet can cover a transaction fee',
                false,
                'The wallet is empty. STK pushes fail with INSUFFICIENT_SERVICE_BALANCE (402) until you top it up.'
            );
        }

        // Without a default channel no payment can start at all.
        $channels = palplus_channels($config);
        $explicit = trim((string) config_value($config, 'palplus.channel_id', ''));
        $hasDefault = false;
        foreach ($channels as $channel) {
            if (!empty($channel['is_default'])) {
                $hasDefault = true;
            }
        }
        $checks[] = check_row(
            'A payment channel can be used',
            $explicit !== '' || $hasDefault,
            $explicit !== ''
                ? 'Using the channel ID set above.'
                : ($hasDefault
                    ? 'Using the account default channel.'
                    : 'No channel ID set and no default channel on the account. Palplus will return 400 NO_DEFAULT_CHANNEL. Set one as default in the Palplus console, or paste a channel ID.')
        );

        if ($channels !== []) {
            $names = array_map(
                static fn ($c) => trim(($c['name'] !== '' ? $c['name'] : $c['id']) . ($c['is_default'] ? ' (default)' : '')),
                $channels
            );
            $checks[] = check_row('Channels on the account', true, implode(', ', array_slice($names, 0, 6)));
        }

        if ($wallet['rate_remaining'] !== null) {
            $checks[] = check_row(
                'Rate limit',
                $wallet['rate_remaining'] > 0,
                $wallet['rate_remaining'] . ' of ' . ($wallet['rate_limit'] ?? 60) . ' requests left this minute.'
            );
        }
        $error = $wallet['error'];
        break;

    case 'nowpayments':
        if (!nowpayments_is_configured($config)) {
            $error = 'No NOWPayments API key is set yet.';
            break;
        }
        $status = nowpayments_status($config);
        $checks[] = check_row('API key is accepted', $status['ok'], $status['error'] ?? $status['message']);
        $checks[] = check_row(
            'IPN secret is set',
            trim((string) config_value($config, 'nowpayments.ipn_secret', '')) !== '',
            'Without it, incoming webhooks cannot be verified and paid orders will not be dispatched.'
        );
        $checks[] = check_row(
            'Webhook URL to register',
            true,
            rtrim((string) config_value($config, 'public_base_url', ''), '/') . '/api/nowpayments/webhook'
        );
        $error = $status['error'];
        break;

    case 'resend':
        if (!email_is_configured($config)) {
            $error = 'No Resend API key is set yet.';
            break;
        }
        $mail = email_check($config);
        $checks[] = check_row('API key is accepted', $mail['error'] !== 'Resend rejected that API key.', $mail['from_domain'] !== null ? 'From: ' . $mail['from_domain'] : null);
        $checks[] = check_row(
            'Sending domain is verified',
            $mail['domain_verified'] === true,
            $mail['error'] ?? ($mail['from_domain'] . ' is verified.')
        );
        if ($mail['domains'] !== []) {
            $checks[] = check_row(
                'Domains on this account',
                true,
                implode(', ', array_map(static fn ($d) => $d['name'] . ' (' . $d['status'] . ')', array_slice($mail['domains'], 0, 6)))
            );
        }
        $error = $mail['error'];
        break;

    case 'smsotp':
        if (!smsotp_is_configured($config)) {
            $error = 'No SMS provider key is set. This is optional — without it, SMS products use only numbers you upload.';
            break;
        }
        $balance = smsotp_balance($config);
        $checks[] = check_row('API key is accepted', $balance['ok'], $balance['error'] ?? null);
        if ($balance['ok']) {
            $minimum = (float) config_value($config, 'smsotp.min_balance', 0.01);
            $checks[] = check_row(
                'Balance can cover the minimum',
                $balance['balance'] > $minimum,
                sprintf('%.2f available, minimum %.2f.', $balance['balance'], $minimum)
            );
        }
        $services = smsotp_services($config);
        if ($services !== []) {
            $checks[] = check_row('Services offered', true, count($services) . ' available, e.g. ' . implode(', ', array_slice(array_column($services, 'id'), 0, 8)));
        }
        $error = $balance['error'];
        break;

    case 'proxycheck':
        $echo = proxycheck_echo_url($config);
        if (!preg_match('#^https?://#i', $echo)) {
            $error = 'No reflector URL, and the public site URL is not set either.';
            break;
        }

        $res = http_json_request('GET', $echo, [], null, 10);
        $reachable = $res['error'] === null && $res['status'] >= 200 && $res['status'] < 300;
        $checks[] = check_row(
            'The server can reach its own reflector',
            $reachable,
            $reachable
                ? $echo
                : ($res['error'] ?? ('HTTP ' . $res['status'])) . ' — if the host blocks outbound requests to itself, set a reflector URL in the Proxy checker section.'
        );
        if ($reachable && is_array($res['body'])) {
            $checks[] = check_row('Reflector reports the server address', true, (string) ($res['body']['ip'] ?? 'unknown'));
        }
        break;

    default:
        json_error('Unknown integration. Use palplus, nowpayments, resend, smsotp or proxycheck.', 422, 'UNKNOWN_INTEGRATION');
}

store_log($config, 'admin.settings.test', [
    'integration' => $integration,
    'ok' => !$error && !array_filter($checks, static fn ($c) => !$c['ok']),
]);

json_ok([
    'integration' => $integration,
    'checks' => $checks,
    'ok' => $error === null && !array_filter($checks, static fn ($c) => !$c['ok']),
    'error' => $error,
]);
