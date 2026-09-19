<?php
/**
 * Transactional email via Resend (https://api.resend.com/emails).
 *
 * Used to send the buyer a copy of their credentials after dispatch.
 * Failures are logged, never surfaced to the customer: the credentials are
 * already on screen and in the ledger by the time this runs.
 */

declare(strict_types=1);

require_once __DIR__ . '/dispatch.php';

function email_is_configured(array $config): bool
{
    return trim((string) config_value($config, 'resend.api_key', '')) !== ''
        && trim((string) config_value($config, 'resend.from', '')) !== '';
}

function email_escape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Builds the HTML body listing an order's credentials. */
function email_credentials_html(array $config, array $order, array $deliverables): string
{
    $orderId = email_escape((string) ($order['order_id'] ?? ''));
    $storeName = email_escape((string) config_value($config, 'store_name', 'Digital Hub Shop'));

    $rows = '';
    $current = null;
    foreach ($deliverables as $unit) {
        $name = (string) ($unit['product_name'] ?? $unit['product_id'] ?? '');
        if ($name !== $current) {
            $rows .= '<tr><td colspan="2" style="padding:14px 0 6px;font:700 12px/1.4 Arial,sans-serif;'
                . 'text-transform:uppercase;letter-spacing:.08em;color:#6b7280;border-top:1px solid #eceef1">'
                . email_escape($name) . '</td></tr>';
            $current = $name;
        }
        $rows .= '<tr>'
            . '<td style="padding:6px 10px 6px 0;font:600 12px/1.5 monospace;color:#111827;white-space:nowrap;vertical-align:top">'
            . email_escape((string) ($unit['uid'] ?? '')) . '</td>'
            . '<td style="padding:6px 0;font:12px/1.5 monospace;color:#111827;word-break:break-all">'
            . email_escape((string) ($unit['secret'] ?? '')) . '</td>'
            . '</tr>';
    }

    if ($rows === '') {
        $rows = '<tr><td style="padding:12px 0;font:13px/1.6 Arial,sans-serif;color:#6b7280">'
            . 'Your credentials are being prepared and will appear in your account shortly.</td></tr>';
    }

    return '<!doctype html><html><body style="margin:0;background:#f8f9fa;padding:24px">'
        . '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:16px;'
        . 'border:1px solid #eceef1;overflow:hidden">'
        . '<div style="background:#e63946;color:#fff;padding:20px 24px">'
        . '<div style="font:800 16px/1.2 Arial,sans-serif;letter-spacing:.04em">' . $storeName . '</div>'
        . '<div style="font:12px/1.5 Arial,sans-serif;opacity:.9;margin-top:4px">Your order is ready</div>'
        . '</div>'
        . '<div style="padding:24px">'
        . '<p style="font:13px/1.6 Arial,sans-serif;color:#111827;margin:0 0 4px">Order reference</p>'
        . '<p style="font:700 14px/1.4 monospace;color:#e63946;margin:0 0 18px">' . $orderId . '</p>'
        . '<p style="font:13px/1.6 Arial,sans-serif;color:#6b7280;margin:0 0 14px">'
        . 'Here are your credentials. Keep this email safe.</p>'
        . '<table style="width:100%;border-collapse:collapse">' . $rows . '</table>'
        . '<div style="margin-top:22px;padding:14px;background:#fffbeb;border:1px solid #fde68a;'
        . 'border-radius:12px;font:12px/1.7 Arial,sans-serif;color:#78350f">'
        . '<strong>Important</strong><br>'
        . 'Log in from a clean IP and set the correct VPN location before your first sign-in where the '
        . 'product requires it. Do not change the password or recovery details for 24 hours. '
        . 'Report any non-working credential within 24 hours for a free replacement.'
        . '</div>'
        . '</div></div></body></html>';
}

/**
 * Sends the credentials email.
 *
 * @return array{ok:bool, status:int, error:?string}
 */
function email_send_credentials(array $config, array $order, array $deliverables): array
{
    if (!email_is_configured($config)) {
        return ['ok' => false, 'status' => 0, 'error' => 'Resend is not configured.'];
    }

    $to = trim((string) ($order['buyer_email'] ?? ''));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'status' => 0, 'error' => 'No valid buyer email on the order.'];
    }

    $orderId = (string) ($order['order_id'] ?? '');
    $from = (string) config_value($config, 'resend.from');

    $payload = [
        'from' => $from,
        'to' => [$to],
        'subject' => 'Your credentials — order ' . $orderId,
        'html' => email_credentials_html($config, $order, $deliverables),
        'text' => dispatch_render_text($order, $deliverables),
    ];

    $replyTo = trim((string) config_value($config, 'resend.reply_to', ''));
    if ($replyTo !== '') {
        $payload['reply_to'] = $replyTo;
    }

    $res = http_json_request(
        'POST',
        'https://api.resend.com/emails',
        [
            'Authorization' => 'Bearer ' . (string) config_value($config, 'resend.api_key'),
            'Content-Type' => 'application/json',
        ],
        $payload,
        20
    );

    $ok = $res['error'] === null && $res['status'] >= 200 && $res['status'] < 300;

    store_log($config, 'email.credentials', [
        'order_id' => $orderId,
        'to' => $to,
        'ok' => $ok,
        'status' => $res['status'],
        'error' => $res['error'],
    ]);

    return [
        'ok' => $ok,
        'status' => $res['status'],
        'error' => $ok ? null : ($res['error'] ?? (string) ($res['body']['message'] ?? 'Send failed')),
    ];
}

/**
 * Post-payment pipeline for one order: claim credentials, then email them.
 *
 * Called from the webhooks after the response has been flushed, and safe to
 * call more than once — `dispatch_order` is idempotent, so a duplicate webhook
 * cannot hand out extra stock or send a second email for the same dispatch.
 *
 * @return array{dispatch:array, email:array}
 */
function settle_paid_order(array $config, string $orderId): array
{
    $dispatch = dispatch_order($config, $orderId);
    $order = store_read_order($config, $orderId);
    $email = ['ok' => false, 'status' => 0, 'error' => 'skipped'];

    if ($order === null) {
        return ['dispatch' => $dispatch, 'email' => $email];
    }

    // Don't re-send if we already emailed this delivery.
    if (!empty($order['email_sent_at'])) {
        return ['dispatch' => $dispatch, 'email' => ['ok' => true, 'status' => 0, 'error' => null]];
    }

    if (!email_is_configured($config)) {
        return ['dispatch' => $dispatch, 'email' => ['ok' => false, 'status' => 0, 'error' => 'Resend not configured']];
    }

    $email = email_send_credentials($config, $order, $dispatch['deliverables']);
    if ($email['ok']) {
        store_update_order($config, $orderId, ['email_sent_at' => gmdate('c')]);
    }

    return ['dispatch' => $dispatch, 'email' => $email];
}
