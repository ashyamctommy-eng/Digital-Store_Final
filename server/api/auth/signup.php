<?php
/**
 * POST /api/auth/signup
 * Create a first-party customer account and start a secure session.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/email.php';

$config = load_config();
require_method('POST');
customer_auth_require_same_origin_json();
customer_auth_rate_limit_or_fail($config, 'signup', 10, 3600);

$body = read_json_body();
$name = is_string($body['name'] ?? null) ? trim($body['name']) : '';
$email = customer_auth_normalise_email($body['email'] ?? '');
$password = is_string($body['password'] ?? null) ? $body['password'] : '';

if (
    $name === ''
    || (function_exists('mb_strlen') ? mb_strlen($name, 'UTF-8') : strlen($name)) > 100
) {
    json_error('Enter your name (up to 100 characters).', 422, 'INVALID_NAME');
}
if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    json_error('Enter a valid email address.', 422, 'INVALID_EMAIL');
}
$passwordLength = function_exists('mb_strlen') ? mb_strlen($password, 'UTF-8') : strlen($password);
if ($passwordLength < 12 || $passwordLength > 128 || strlen($password) > 1024) {
    json_error('Use a password between 12 and 128 characters.', 422, 'WEAK_PASSWORD');
}
if (!email_is_configured($config)) {
    json_error('Email verification is temporarily unavailable. Please try again later.', 503, 'EMAIL_NOT_CONFIGURED');
}

$token = bin2hex(random_bytes(32));
$created = customer_auth_create_user(
    $config,
    $email,
    $name,
    $password,
    hash('sha256', $token),
    time() + 86400
);
if (!$created['ok']) {
    if (($created['error'] ?? '') === 'EMAIL_ALREADY_REGISTERED') {
        $existing = customer_auth_read_user($config, $email);
        if ($existing !== null && empty($existing['email_verified_at'])) {
            $issued = customer_auth_issue_verification($config, $email);
            if ($issued !== null) {
                email_send_verification($config, $issued, (string) $issued['verification_token']);
            }
        }
        json_response(['verification_required' => true], 202);
    }
    json_error('Account service is temporarily unavailable.', 503, 'AUTH_STORAGE_UNAVAILABLE');
}

$sent = email_send_verification($config, $created['user'], $token);
if (!$sent['ok']) {
    json_error('We could not send the verification email. Use the resend option or try again later.', 503, 'EMAIL_SEND_FAILED');
}
json_response(['verification_required' => true], 202);
