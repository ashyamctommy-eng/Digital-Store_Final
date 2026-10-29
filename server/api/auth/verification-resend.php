<?php
/**
 * POST /api/auth/verification-resend
 * Resend a verification message without revealing whether an account exists.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/email.php';

$config = load_config();
require_method('POST');
customer_auth_require_same_origin_json();
customer_auth_rate_limit_or_fail($config, 'verification-resend-ip', 10, 3600);

$body = read_json_body();
$email = customer_auth_normalise_email($body['email'] ?? '');
if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    json_error('Enter a valid email address.', 422, 'INVALID_EMAIL');
}
customer_auth_rate_limit_or_fail($config, 'verification-resend-email', 3, 3600, $email);

if (!email_is_configured($config)) {
    json_error('Email verification is temporarily unavailable. Please try again later.', 503, 'EMAIL_NOT_CONFIGURED');
}

$user = customer_auth_issue_verification($config, $email);
if ($user !== null) {
    email_send_verification($config, $user, (string) $user['verification_token']);
}

// Same response for unknown, verified, and pending accounts prevents account
// discovery through this endpoint. Delivery failures are recorded server-side.
json_response(['verification_requested' => true], 202);
