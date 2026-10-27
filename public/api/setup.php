<?php
// First-time setup: choose a username and password, and give the server the
// notes repository and GitHub access key. Only works while nothing is set up yet.
define('COMMITBOOK', 1);
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') cb_back();
if (cb_config()) cb_back(['setup' => 'done']);

$user = trim((string) ($_POST['username'] ?? ''));
$pass = (string) ($_POST['password'] ?? '');
$pass2 = (string) ($_POST['password2'] ?? '');
$repoIn = trim((string) ($_POST['repo'] ?? ''));
$token = trim((string) ($_POST['token'] ?? ''));
$keep = ['u' => substr($user, 0, 64), 'r' => substr($repoIn, 0, 120)];

$fail = fn(string $code) => cb_back(['setup' => $code] + $keep);
if (!cb_valid_username($user)) $fail('username');
if (strlen($pass) < 10) $fail('short');
if ($pass !== $pass2) $fail('mismatch');
$repo = cb_parse_repo($repoIn);
if (!$repo) $fail('repo');
if ($token === '') $fail('token');

$problem = cb_check_github($repo[0], $repo[1], $token);
if ($problem) {
    cb_back(['setup' => 'github', 'msg' => substr($problem, 0, 300)] + $keep);
}

cb_save_config([
    'username' => $user,
    'password_hash' => password_hash($pass, PASSWORD_DEFAULT),
    'owner' => $repo[0],
    'repo' => $repo[1],
    'token' => $token,
    'created' => gmdate('c'),
]);
cb_sign_in($user, !empty($_POST['remember']));
cb_back(['setup' => 'ok']);
