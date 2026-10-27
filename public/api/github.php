<?php
// Passes the app's requests on to GitHub, adding the access key on the server so it
// never reaches the browser. Only the configured notes repository can be reached,
// and only the parts of the API the app uses.
define('COMMITBOOK', 1);
require __DIR__ . '/lib.php';

cb_require_app_request();
cb_require_user();
$c = cb_config();
if (!$c) cb_fail(409, 'This server isn’t set up yet.');
session_write_close();   // don't hold the session lock while waiting for GitHub

$method = $_SERVER['REQUEST_METHOD'];
if (!in_array($method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], true)) cb_fail(405, 'Not allowed.');

$p = (string) ($_GET['p'] ?? '');
$base = '/repos/' . $c['owner'] . '/' . $c['repo'];
$q = strpos($p, '?');
$path = $q === false ? $p : substr($p, 0, $q);
$query = $q === false ? '' : substr($p, $q);

if (strcasecmp(substr($path, 0, strlen($base)), $base) !== 0) cb_fail(403, 'Only the notes repository can be reached.');
$rest = substr($path, strlen($base));
$allowed = $rest === ''
    || preg_match('#^/git/(ref|refs|trees|blobs|commits)(/|$)#', $rest)
    || preg_match('#^/contents(/|$)#', $rest)
    || preg_match('#^/commits(/|$)#', $rest);
if (!$allowed || strpos($rest, '..') !== false) cb_fail(403, 'That part of GitHub isn’t used by Commitbook.');
if ($rest === '' && $method !== 'GET') cb_fail(403, 'Not allowed.');

$body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? (string) file_get_contents('php://input') : null;
[$status, $out, $headers] = cb_github($method, $base . $rest . $query, $body, $c['token'], $c);

http_response_code($status);
header('Content-Type: ' . ($headers['content-type'] ?? 'application/json; charset=utf-8'));
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
foreach (['x-ratelimit-remaining', 'x-ratelimit-reset'] as $h) if (isset($headers[$h])) header("$h: {$headers[$h]}");
echo $out;
