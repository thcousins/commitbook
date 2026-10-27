<?php
// Tells the app whether this server is set up and whether you're signed in.
define('COMMITBOOK', 1);
require __DIR__ . '/lib.php';

$c = cb_config();
$user = $c ? cb_user() : null;
cb_json([
    'app' => 'commitbook',
    'version' => CB_VERSION,
    'setup' => (bool) $c,
    'signedIn' => (bool) $user,
    'user' => $user,
    'repo' => $user && $c ? ['owner' => $c['owner'], 'repo' => $c['repo']] : null,
    'lockedFor' => $user ? 0 : cb_locked_for(),
]);
