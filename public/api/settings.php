<?php
// Change the password, the GitHub access key or the notes repository.
// Needs the current password.
define('COMMITBOOK', 1);
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') cb_fail(405, 'Use the settings in the app.');
cb_require_app_request();
cb_require_user();
$c = cb_config();
if (!$c) cb_fail(409, 'This server isn’t set up yet.');

$in = cb_body_json();
if (!password_verify((string) ($in['currentPassword'] ?? ''), $c['password_hash'])) {
    cb_record_fail();
    cb_fail(403, 'Your current password isn’t right.');
}

$changed = [];
if (!empty($in['newPassword'])) {
    if (strlen($in['newPassword']) < 10) cb_fail(422, 'Use at least 10 characters for the new password.');
    $c['password_hash'] = password_hash((string) $in['newPassword'], PASSWORD_DEFAULT);
    $changed[] = 'password';
}
if (!empty($in['username'])) {
    if (!cb_valid_username((string) $in['username'])) cb_fail(422, 'Usernames can use letters, numbers and . _ @ + - (2 to 64 characters).');
    $c['username'] = (string) $in['username'];
    $changed[] = 'username';
}
$owner = $c['owner']; $repo = $c['repo']; $token = $c['token'];
if (!empty($in['repo'])) {
    $r = cb_parse_repo((string) $in['repo']);
    if (!$r) cb_fail(422, 'Enter the repository as owner/name.');
    [$owner, $repo] = $r;
}
if (!empty($in['token'])) $token = trim((string) $in['token']);
if ($owner !== $c['owner'] || $repo !== $c['repo'] || $token !== $c['token']) {
    $problem = cb_check_github($owner, $repo, $token, $c);
    if ($problem) cb_fail(422, $problem);
    $c['owner'] = $owner; $c['repo'] = $repo; $c['token'] = $token;
    $changed[] = 'github';
}
cb_save_config($c);
if (in_array('password', $changed, true)) {
    cb_forget_devices();
    cb_sign_in($c['username'], !empty($in['remember']));
}
cb_json(['ok' => true, 'changed' => $changed, 'repo' => ['owner' => $c['owner'], 'repo' => $c['repo']]]);
