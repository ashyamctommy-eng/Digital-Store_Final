<?php
/**
 * GET /api/auth/me
 * Return the current first-party customer session, if any.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/auth.php';

$config = load_config();
require_method('GET');
customer_auth_start_session($config);

$user = $_SESSION['customer'] ?? null;
if (!is_array($user) || empty($user['id']) || empty($user['email'])) {
    json_ok(['authenticated' => false, 'user' => null]);
}

json_ok([
    'authenticated' => true,
    'user' => customer_auth_public_user($user),
]);
