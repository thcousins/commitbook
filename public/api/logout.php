<?php
// Sign out on this device.
define('COMMITBOOK', 1);
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') cb_fail(405, 'Use the Sign out button in the app.');
cb_require_app_request();
cb_sign_out();
cb_json(['ok' => true]);
