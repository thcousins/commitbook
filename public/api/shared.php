<?php
// The note behind a share link, for anyone who has the link. Read-only, one note only.
define('COMMITBOOK', 1);
require __DIR__ . '/lib.php';

header('X-Robots-Tag: noindex, nofollow');
$token = (string) ($_GET['t'] ?? '');
$gone = fn() => cb_fail(404, 'This link isn’t valid, or sharing has been turned off.');
if (!preg_match(CB_SHARE_RE, $token)) $gone();
$c = cb_config();
if (!$c) $gone();
$all = cb_shares();
$share = $all[$token] ?? null;
if (!$share || (!empty($share['expires']) && $share['expires'] <= time())) $gone();

// A short cache, so a link that's busy doesn't use up GitHub's hourly allowance.
$cacheFile = cb_data_dir() . '/share-cache-' . substr(hash('sha256', $token), 0, 16) . '.json';
if (is_file($cacheFile) && filemtime($cacheFile) > time() - 15) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    readfile($cacheFile);
    exit;
}
$found = cb_find_shared_note($c, $token, $share);
if (!$found) { @unlink($cacheFile); $gone(); }
[$path, $data, $body] = $found;
$payload = [
    'title' => (string) ($data['title'] ?? preg_replace('/\.md$/i', '', basename($path))),
    'updated' => (string) ($data['updated'] ?? ''),
    'body' => $body,
];
@file_put_contents($cacheFile, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
cb_json($payload);
