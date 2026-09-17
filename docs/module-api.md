# Implemented module API

This reference describes implemented contracts, not the target architecture.
Read the [modular design contract](modular-design.md) when proposing capabilities.
The broad native-workspace launch operations below are compatibility exceptions;
new modules should own their feature logic and UI through reusable capabilities.
API 0.9 adds the bounded transport and one-shot location contracts below.
Unrestricted WebView networking/geolocation and general native rendering remain unavailable.

The current host accepts exact `constructApi.min == constructApi.target` versions
0.1.0 through 0.9.0. Module versions are three numeric components. See the
[manifest schema](../schemas/module-manifest.schema.json) and runnable
[examples](../examples); the native validator is authoritative.

## Manifest and transport

A signed ZIP contains `manifest.json`, an HTML entry and local assets. Runtime is
`webview-js`. Capabilities declare `id`, `reason` and `optional`; `net.http` additionally requires
a signed `origins` list. There are no
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
revoked. Tone, contacts, camera, photo measurement, Sky Watch, HTTP and location start off and require explicit native opt-in.
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
eight photos, 4 MiB per file, 20 MiB per module and 64 MiB globally. Starting in
alpha 12, Android 10+ has a native **Save to phone gallery** action for the selected
photo. It requires human confirmation and both existing camera gates, copies to
Pictures/Construct through a pending MediaStore item, and checks session/access
again before publication. JavaScript cannot invoke this action. No additional
storage permission is requested. Android 9 retains private-album functionality
but has no gallery export in this slice.

Gallery copies are independent: deleting private photos, removing module code or
uninstalling Construct does not remove exported copies. Gallery/photo apps may
read or back them up according to the user's settings. Native private-photo
deletion remains available with camera access off. Removing module code retains
private data; clearing app data/uninstalling Construct removes that private data.

Alpha 13 also offers native, user-requested face/common-object analysis of a
selected private photo. Both models are bundled and run locally; no bridge
operation exposes analysis or its results. Results are ephemeral and do not
modify exported or private JPEGs. A final access check precedes display. This
does not identify people or infer emotion; labels/scores can be wrong. See
[photo analysis](photo-analysis.md).

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
accessibility issue. There is no background alarm/service, contacts write, module
gallery-export API, face analysis or general network API in this release.

## Photo measurement (API 0.7.0)

`photo.measure` accepts **only** `{op:"open"}` and returns `{opened:true}`.
It requires an explicit native grant, off by default. It opens Pocket Measure's
native workspace, not a caller-selected URI or an automatic camera capture.
Android's single-image photo picker (document-picker fallback on older devices)
is the only image source. No broad gallery/storage permission is added.

The user chooses a photo, confirms the actual printed marker side (10–300 mm),
then taps two endpoints. OpenCV 4.12.0 detects DICT_4X4_50 marker ID 0; exactly one
is required. A homography maps endpoints into its plane. Results are approximate
straight-line lengths, not surface-following lengths or object heights. The
reference and endpoints must be coplanar. There is no lens calibration, object
recognition, export, saved measurement, or background processing contract.

Reads are bounded to 20 MiB, decoded dimensions to 12000 per side, and the
working bitmap to 1600 pixels on its longest side. Detector work is serialized;
a new photo, closure or loss of authority invalidates pending results. Picker
handoff is an explicit lifecycle exception; other backgrounding or rotation
closes and clears the workspace. Process recreation does not restore it.
No URI, pixels, marker size, endpoints or lengths are returned to JavaScript or
written to diagnostics. User-selected originals are never modified.

## Legacy Sky Watch launcher (API 0.8.0)

`sky.watch` accepts only `{op:"open"}` and returns `{opened:true}`. The explicit
native grant opens a foreground aircraft-map workspace. The human chooses an area,
source(s), radius and optional foreground Android location permission there.
No coordinates, URLs, credentials, aircraft records or images pass through the
module bridge. Closing/backgrounding discards the session and stops location and
requests; rotation retains it. Selected areas leave the phone for aircraft data
and map tiles; the consent text names those providers. See [Sky Watch](sky-watch.md)
for data formats, merge policy, rate limits, caching, privacy and attribution.


## Approved HTTP transport (`net.http`, API 0.9)

This is a reusable GET transport, not a provider adapter. Declare **1–8 unique,
exact HTTPS origins** in the signed capability, for example:

```json
{"id":"net.http","reason":"Read public map and aircraft data",
 "origins":["https://api.adsb.lol","https://tile.openstreetmap.org"]}
```

Origins must be lowercase DNS names with no credentials, wildcard, explicit port,
path, query or fragment. Local names and IP literals are rejected. Every request
must remain on one of the declared origins; paths and queries are module-owned.
Consent lists the actual signed origins. The capability starts off. A module
update expanding its approved origin set disables the grant unless the human
explicitly approves the new scope. Rollback cannot recover a wider scope after
narrower consent. The installed package digest is rechecked on each operation.

Request: exactly `{op:'get', url, format:'json'}` or `format:'image'`.
URL length is at most 2,048 characters. Result is `{status, headers, text}` for
HTTP 200 JSON, or `{status, headers, dataUrl}` for an HTTP 200 raster image.
Other statuses have no response-body data. Modules parse JSON and interpret
statuses, retry policy and domain records. No route/provider logic lives here.

- HTTPS only; normal certificate/hostname verification. The actual HTTP client's
  DNS lookup rejects non-public addresses, including private/local and common
  transition ranges. No redirects, proxy routing, cookies, auth, caller headers,
  request bodies or arbitrary methods. Fixed application User-Agent and Accept.
- At most four concurrent requests per session and 180 submissions/minute per
  module, with the latter persisted across reopen. Eight-second connect/read and
  15-second total timeouts. Cancellation occurs on menu pause or close.
- At most 2 MiB JSON or 256 KiB raster bytes after decompression. JSON MIME must be
  `application/json`. Images must be PNG/JPEG/WebP with matching signature,
  dimensions 1–4,096 each and at most 4,194,304 pixels. SVG/HTML are not image results.
- Only cache-control, expires, age, retry-after and the two documented rate-limit
  headers are returned, each capped at 512 characters. Cookies/redirect locations
  and arbitrary response headers are not exposed.
- JSON is requested with `Cache-Control: no-store`. Raster HTTP cache respects
  response freshness/revalidation, at most 12 MiB per module; older other-module
  caches are evicted to at most 50 MiB when opening a session. Caches are disposable.
  No tile prefetch is performed by the host. The module decides what to request.
- Authorization is checked again after reading and on main-thread delivery;
  menu-generation changes invalidate replies. Revocation cannot retract data
  already delivered to module code or an external service.

Errors include `HTTP_PARAMS`, `HTTP_URL`, `HTTP_SOURCE`, `HTTP_BUSY`, `HTTP_RATE`,
`HTTP_DATA`, `HTTP_SIZE`/`SIZE_LIMIT` and `HTTP_UNAVAILABLE`, plus common grant/session
errors. Allow a bridge timeout longer than 15 seconds. Direct `fetch`, XHR,
WebSocket, remote scripts/navigation and WebView geolocation remain blocked.

## Foreground location (`location.read`, API 0.9)

Request exactly `{op:'get'}`. Result:
`{latitude, longitude, accuracyM, timestamp, approximate}`. Coordinates are degrees;
accuracy is metres; timestamp is Unix milliseconds. `approximate` reflects Android
coarse-only permission, not a claim about measured positional quality.

Both explicit module consent and Android foreground coarse or fine permission are
required. Android permission is requested only by the human-operated **Module
access** control, never by JavaScript. Manual-area modules can work without it.

A result is either a valid cached fix at most 120 seconds old (monotonic age) or
one foreground provider update, with a 12-second timeout. One pending request and
15-second request spacing per session; no continuous subscription, background
tracking or background permission. Native listeners and timeout are removed on
completion, cancellation or close. Data is re-authorized before delivery.
Errors include `LOCATION_PERMISSION`, `LOCATION_PARAMS`, `LOCATION_BUSY`,
`LOCATION_RATE`, `LOCATION_TIMEOUT`, `LOCATION_DATA`, `LOCATION_UNAVAILABLE` and
`LOCATION_CANCELLED`, plus common grant/session errors.

**Composition matters:** unlike the legacy Sky launcher, these capabilities return
data to module JavaScript. If internet access is also granted, the module may send
location or other granted data to its approved origins. If storage is granted, it
may retain copies. Native consent states this; revocation is not retroactive erasure.

API 0.9 module text follows Android font scale through WebView text zoom (50–300%).
Font-scale configuration changes retain the live module session, like rotation.
Module layouts must allow wrapping/scrolling; a module-owned Canvas supplies its
own accessible text/list alternative. Older API modules retain legacy text sizing.
