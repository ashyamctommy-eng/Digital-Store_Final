<?php
/**
 * GET /api/admin/auth/me
 * Read the current admin session without exposing bootstrap credentials.
 */

declare(strict_types=1);

require_once __DIR__ . '/../../lib/http.php';
require_once __DIR__ . '/../../lib/admin-auth.php';

$config = load_config();
require_method('GET');
$user = admin_auth_current_user($config);

json_ok([
    'configured' => admin_auth_is_configured($config),
    'authenticated' => $user !== null,
    'user' => $user,
]);
