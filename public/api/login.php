<?php
// Sign in. The app's sign-in page posts an ordinary form here, so browsers and
// password managers (Apple Passwords, iCloud Keychain, 1Password…) save and fill it.
define('COMMITBOOK', 1);
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') cb_back();
$c = cb_config();
if (!$c) cb_back();

$wait = cb_locked_for();
if ($wait > 0) cb_back(['signin' => 'locked', 'wait' => (string) ceil($wait / 60)]);

$user = trim((string) ($_POST['username'] ?? ''));
$pass = (string) ($_POST['password'] ?? '');
$remember = !empty($_POST['remember']);

$okUser = hash_equals(strtolower($c['username']), strtolower($user));
$okPass = password_verify($pass, $c['password_hash']);   // always run, so timing doesn't reveal the username

if (!$okUser || !$okPass) {
    cb_record_fail();
    usleep(random_int(300000, 700000));
    $wait = cb_locked_for();
    cb_back($wait > 0 ? ['signin' => 'locked', 'wait' => (string) ceil($wait / 60)] : ['signin' => 'failed', 'u' => substr($user, 0, 64)]);
}

cb_clear_fails();
if (password_needs_rehash($c['password_hash'], PASSWORD_DEFAULT)) {
    $c['password_hash'] = password_hash($pass, PASSWORD_DEFAULT);
    cb_save_config($c);
}
cb_sign_in($c['username'], $remember);
cb_back();
