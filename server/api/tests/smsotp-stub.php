<?php
/**
 * Stub of the smsotp.net API, for testing the on-demand fallback without
 * spending real balance or needing an account.
 *
 * Run:  php -S 127.0.0.1:8905 tests/smsotp-stub.php
 *
 * It implements the documented v1.0 shapes:
 *   GET /api/v1/get-balance   -> {success, data:{balance}}
 *   GET /api/v1/services      -> {success, data:[{id,name},…]}
 *   GET /api/v1/otp/rent      -> {success, data:{phoneNumber, smsPhoneId, operator}}
 *   GET /api/v1/otp/info      -> {success, data:{smsCode, smsText}}
 *
 * Behaviour is driven by a JSON state file (path in SMSOTP_STUB_STATE) so a test
 * can lower the balance, make the code "not yet arrived", and assert how many
 * times the provider was actually charged.
 */

declare(strict_types=1);

$statePath = getenv('SMSOTP_STUB_STATE') ?: sys_get_temp_dir() . '/smsotp-stub.json';

function stub_state(string $path): array
{
    $defaults = [
        'balance' => 99.94,
        'rent_calls' => 0,
        'info_calls' => 0,
        // A code appears only after this many /otp/info polls, so "pending" can
        // be exercised before the SMS arrives.
        'code_after_polls' => 1,
        'code' => 123456,
        'rent_fails' => false,
        'next_phone' => 15551230000,
    ];
    if (!is_file($path)) {
        return $defaults;
    }
    $raw = @file_get_contents($path);
    $decoded = $raw === false ? null : json_decode($raw, true);
    return is_array($decoded) ? array_merge($defaults, $decoded) : $defaults;
}

function stub_save(string $path, array $state): void
{
    @file_put_contents($path, json_encode($state), LOCK_EX);
}

function stub_out(array $payload): void
{
    header('Content-Type: application/json');
    echo json_encode($payload);
    exit;
}

$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$state = stub_state($statePath);

// The client sends the key as a query parameter; reject requests without one so
// a misconfiguration in config.php surfaces in the tests.
if (($_GET['api_key'] ?? '') === '') {
    stub_out(['success' => false, 'message' => 'api_key is required']);
}

switch ($path) {
    case '/api/v1/get-balance':
        stub_out(['success' => true, 'data' => ['balance' => (string) $state['balance']]]);

    case '/api/v1/services':
        stub_out([
            'success' => true,
            'data' => [
                ['id' => 'wa', 'name' => 'WhatsApp'],
                ['id' => 'tg', 'name' => 'Telegram'],
                ['id' => 'fb', 'name' => 'Facebook'],
                ['id' => 'go', 'name' => 'Google,youtube,Gmail'],
                ['id' => 'lf', 'name' => 'TikTok/Douyin'],
            ],
        ]);

    case '/api/v1/otp/rent':
        if ($state['rent_fails']) {
            stub_out(['success' => false, 'message' => 'No numbers available']);
        }
        $state['rent_calls']++;
        $phone = (int) $state['next_phone'] + $state['rent_calls'] - 1;
        // The real provider returns the number as a bare integer.
        stub_save($statePath, $state);
        stub_out([
            'success' => true,
            'data' => [
                'phoneNumber' => $phone,
                'country' => 2,
                'service_id' => (string) ($_GET['service_id'] ?? 'wa'),
                'service_name' => 'Test Service',
                'smsPhoneId' => 90000 + $state['rent_calls'],
                'operator' => 'StubTel',
            ],
        ]);

    case '/api/v1/otp/info':
        $state['info_calls']++;
        stub_save($statePath, $state);
        if ($state['info_calls'] > (int) $state['code_after_polls']) {
            stub_out([
                'success' => true,
                'data' => [
                    'serviceId' => 1,
                    'serviceName' => 'Test Service',
                    'countryId' => 2,
                    'smsCode' => $state['code'],
                    'smsText' => 'Your verification code is ' . $state['code'],
                ],
            ]);
        }
        // Code has not arrived yet.
        stub_out([
            'success' => true,
            'data' => [
                'serviceId' => 1,
                'serviceName' => 'Test Service',
                'countryId' => 2,
                'smsCode' => '',
                'smsText' => '',
            ],
        ]);
}

header('Content-Type: application/json');
echo json_encode(['success' => false, 'message' => 'unknown stub route: ' . $path]);
exit;
