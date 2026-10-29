<?php
/**
 * POST /api/admin/auth/logout
 * End the current admin session.
 */

declare(strict_types=1);

require_once __DIR__ . '/../../lib/http.php';
require_once __DIR__ . '/../../lib/admin-auth.php';

$config = load_config();
require_method('POST');
customer_auth_require_same_origin_json();
admin_auth_start_session($config);
admin_auth_destroy_session();

json_ok(['authenticated' => false]);
