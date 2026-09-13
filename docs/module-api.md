# Implemented module API

The current host accepts exact `constructApi.min == constructApi.target` versions
0.1.0 through 0.6.0. Module versions are three numeric components. See the
[manifest schema](../schemas/module-manifest.schema.json) and runnable
[examples](../examples); the native validator is authoritative.

## Manifest and transport

A signed ZIP contains `manifest.json`, an HTML entry and local assets. Runtime is
`webview-js`. Capabilities declare `id`, `reason` and `optional`; there are no
implemented capability tiers or arbitrary native-code modules. Identity is bound
to the installed package, never supplied by a bridge caller.

The host injects an origin-scoped message port, not a Java object bridge:

```js
construct.postMessage(JSON.stringify({
  id: 'request-1', method: 'storage.kv',
  params: {op: 'get', key: 'counter'}
}));
construct.onmessage = event => {
  const reply = JSON.parse(event.data);
  // reply.id and either reply.result or reply.error {code, message}
};
```

Main-frame messages only; maximum 8,192 characters and 30 requests/second. Floods
may be dropped. Check declaration, saved grant and relevant Android permission on
every request. Sensitive asynchronous results are re-authorized at delivery.

Legacy storage/log/toast access is approved at installation unless previously
revoked. Tone, contacts and camera start off and require explicit native opt-in.
Updates/rollback preserve revoked access. Required access has confirmation before
revocation. Native consent explains contacts plus storage when both are declared:
a granted module can retain data it has read; revocation is not retroactive erasure.

## Capabilities

- **`device.toast` (0.1+):** `{message}`; 200 characters, at most one per 1.5 seconds.
- **`log.write` (0.1+):** `{level, message}` with info/warn/error, 500 characters;
  ten module records per five seconds. No caller-controlled structured fields are
  persisted. Host and module logs are separate. A console ERROR fails the run;
  use `log.write` for nonfatal diagnostic errors. Never log personal data.
- **`storage.kv` (0.1+):** `{op:'get', key}` or `{op:'set', key, value}`.
  Get returns a JSON value or null; set returns null. Keys match
  `[A-Za-z0-9_.-]{1,80}`; 100 keys and 64 KiB serialized UTF-8 per module.
- **`device.tone` (0.2+):** exactly `{pattern:'beep'}` or `{pattern:'double'}`.
  Returns `{accepted:true, pattern}` for native submission, not audibility.
  Fixed bounded patterns, two-second rate limit; native playback stops when the
  session loses authority. Silent/vibrate/DND policy can return `AUDIO_MUTED`.
  This capability does not grant arbitrary audio streaming or microphone access.
- **`contacts.read` (0.3+):** bounded native provider search/details, below.
- **`camera.capture` (0.4+):** native human-operated workspace, below.

Denials are structured errors, not permission prompts initiated by JavaScript.
Android permission is requested only from native Module access UI. Malformed,
stale, throttled or unavailable operations also return structured errors.

## Contacts

Search: `{op:'search', query}`; optionally add a current-search `cursor`. Query is
at most 80 characters. Blank query **browses** the granted address book; it is not
a per-contact privacy boundary. Pocket Contacts makes Browse an explicit action.
Nonempty queries use Android's default-directory name filter. Matching and locale
ordering are provider-dependent, not a universal fuzzy-search promise.

Result: `{items:[{ref,name}], next, limited}`. Pages contain at most 20 rows and
one search admits at most ten pages/200 contacts. Name-first localized sort keys
with an ID tie-breaker preserve duplicate-name pagination. Cursors are opaque,
single-use and query-bound. Starting a new search invalidates previous refs.

Details: `{op:'get', ref}` returns name, string arrays `phones`/`emails`, aligned
`phoneLabels`/`emailLabels`, and `limited`. Values are capped at 200 characters;
at most 20 phone/email rows. No raw IDs, arbitrary provider URI, projection, SQL,
editing, calling or export. References live only in the active reader/session.

Requests are rate-limited to 300 ms spacing with a four-second timeout and a
process-wide bounded worker/queue. A provider ignoring cancellation can remain
busy; close/reopen guidance is intentional, not a claim that timeout kills the
provider. Module and Android permission are checked before delivering data.

## Camera

Only `{op:'open'}` is supported. `{opened:true}` acknowledges a native workspace,
**not** a captured image. Both module grant and Android CAMERA are required.
Opening closes the WebView. Capture and confirmed deletion are native human
controls. Backgrounding or rotation closes the camera; saved photos remain.

JavaScript receives no camera frames, shutter API, file path, image bytes, album
listing or export API. Photos remain in app-private per-module storage: at most
eight photos, 4 MiB per file, 20 MiB per module and 64 MiB globally. They do not
appear in the Android gallery. Native deletion remains available with camera
access off. Removing module code retains its data; clearing app data/uninstalling
Construct removes app-private data. This is not a backup or export facility.

## Lifecycle and module-first UI

Real backgrounding/closing destroys the module runtime; reopening starts fresh.
Persist important state through KV where declared. Rotation retains the WebView
and resizes it in place. Modules should pause interactive work on resize and the
advisory `constructvisibilitychange` event (`event.detail.visible === false`).
The host gates native authority before dispatching pause intent, then pauses the
WebView after acknowledgement or a bounded fallback. Do not assume all JavaScript
timers stop just because the menu is visible.

API 0.5+ receives the full safe viewport and must reserve the top-right 56×56 CSS-px
native menu rectangle with a device-width/initial-scale=1 viewport. Earlier APIs
receive a compatibility strip: top in portrait, right in landscape.

API 0.6 optionally declares `themeColor` as exactly `#RRGGBB` to theme native edges
and contrasting system-bar glyphs. Load the host stylesheet before module styles:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/construct-host.css">
<link rel="stylesheet" href="style.css">
```

It supplies `--construct-menu-width`, `--construct-menu-height`,
`--construct-menu-top` and `--construct-menu-right`. Consume these variables rather
than duplicating native constants. They describe the physical top-right safe
viewport corner, not an authority/security boundary. System bars, cutouts and
keyboard are handled by native insets.

Back dismisses the keyboard first; otherwise it opens the native menu. Another
Back/outside tap returns to the module. Diagnostics retains the paused session;
Module access and Mark working stop it. Close is explicit. Runtime errors remain
visible without hunting through a menu. Mark working is a human checkpoint, not
an automatic health certificate; rollback restores code, not historical data.

See [architecture](architecture.md), [security](../SECURITY.md) and
[evidence limits](evidence.md), including the known camera direct-Reopen
accessibility issue. There is no background alarm/service, contacts write, gallery
export, face analysis or general network API in this release.
