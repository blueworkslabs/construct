# Space Watch 0.1.6 staging

Status: **13/13 exact-package Android checks passed; ready for real-phone testing.**
The emulator stopped cleanly. PR remains unmerged; no production promotion.

## Artifacts and boundary

Module-only change on the implemented API 0.9. The host was not rebuilt or changed.
Staging uses existing alpha34 source `e1318303cbb64e43360a2807b81c3beebb5806c6`,
x86 APK SHA-256 `990f178d0516f4d0797b98d12c62da3813d665087e725a464ec7300851b65dbc`.

Module source: `f092385`; immutable packages:
`83a16ad3af6cf551fdf9a89fa5a551f39de40098`.

- Space Watch: `159262e0b2008b56130f92171eac929048236f0fd565444e639f8e5e42fd299c`.
- Synthetic Space Watch: `73152781304f28b4a6d7be6af76f2d6da60d18b034096c77cf943bf01e8041db`.

Served bytes and signatures were reverified before staging. The runner verifies
APK checksum and native installed package digests. Synthetic answers intentionally
bypass location/orbit grants; only the separate real-module checks prove those gates.

## Exact-version acceptance

Final run: `20260927T230806Z-space-ce0668fa`, Android API 37 on the dedicated
staging emulator with WebView 155; driver/package commit `83a16ad`.
`complete=true`, `stopped=true`; systemd result `success`, exit status `0`,
and the emulator service independently confirmed inactive.

The runner exercises 13 checks: signed install/dome/list; stage pointing;
real same-launch and explicit Wikipedia attribution; red/rewind; process-restart
persistence; actual canvas selection; landscape; 200% text; native menu resume;
real location denial; manual place with HTTP denial; grant change followed by
automatic live CelesTrak load; and offline process reopen with both data links off.

See the [sanitized receipt](evidence/space-watch-0.1.6-staging-2026-09-27.json)
and [phone checklist with the immutable catalog](space-watch-0.1.6-hardware-check.md).
The catalog contains both packages; install **Space Watch**, not Synthetic Space Watch,
for hardware testing. No new APK is needed.

Live provider status: `Orbit data 20 h old · CelesTrak`. The observed live capture
was `2 visible · 4 above you`; offline reopen was `0 visible · 11 above you`.
The runner's capture scroll crossed the rewind range: the live image shows
**4 min 40 sec ago**, while the offline image shows **Now**. These counts are
not a same-time comparison. Loading after grants was automatic (no manual Refresh);
offline reopen used the cache with Wi-Fi and mobile data actually disabled.
The retained crash buffer contains an emulator Bluetooth-service abort during
startup, not a Construct crash. No Construct fatal exception was found in it or
the retained runtime log.

At publication, Pages passed and GitHub `source-and-android` was still in the
JVM/lint/APK-build stage. The tested module/package, local contracts and exact
staging APK are identified here; this is not a claim of completed full CI.

## Original Android captures

These are emulator-console display captures, not browser previews or altered mockups.
The landscape PNG preserves the emulator's native capture orientation; rotate the
viewer to read it. Large text/detail captures are intentionally scrolled to controls.

- [Dome and list](images/space-watch-0.1.6/space-dome.png)
- [Pointing card](images/space-watch-0.1.6/space-spot.png)
- [Wikipedia and attribution](images/space-watch-0.1.6/space-wikipedia.png)
- [Red/rewind](images/space-watch-0.1.6/space-red-rewind.png) and
  [red after process restart](images/space-watch-0.1.6/space-reopened.png)
- [Canvas-selected ISS](images/space-watch-0.1.6/space-canvas-selected.png)
- [Landscape dome](images/space-watch-0.1.6/space-landscape.png) and
  [landscape details](images/space-watch-0.1.6/space-landscape-details.png)
- [200% text dome](images/space-watch-0.1.6/space-large-text.png) and
  [200% details](images/space-watch-0.1.6/space-large-text-details.png)
- [Real location denied](images/space-watch-0.1.6/space-real-location-denied.png) and
  [real internet denied](images/space-watch-0.1.6/space-real-internet-denied.png)
- [Real live data](images/space-watch-0.1.6/space-real-network.png) and
  [offline reopen](images/space-watch-0.1.6/space-real-offline-cache.png)

## Review fixes

- Corrupt numeric cached epochs no longer abort startup; invalid chunks are discarded.
- Same-launch caching retains bounded validated rows, excluding the currently selected
  object when deriving companions rather than caching the first selection's exclusion.
- Closing/reopening a detail view invalidates stale Wikipedia/launch replies.
- Platform dialog cancellation invalidates an in-flight manual location request.
- Menu-interrupted catalog downloads can retry promptly instead of waiting 15 minutes.

- Grant-denied requests no longer impose a provider retry delay; reopening after
  granting internet must automatically fetch, without a compensating Refresh tap.
- Catalog 403/429 and malformed-data responses observe a persisted two-hour backoff.
- Visible-pass countdowns now stop at morning twilight as well as setting/shadow.
- Refreshing orbit rows invalidates name-derived descriptions and list rows;
  catalog replacement also invalidates the list. Regression checks the selected
  title, list title and Wikipedia target without a compensating SATCAT download.
- Empty or malformed same-launch replies are unavailable and are not cached;
  a valid self-only catalog still correctly reports no companions. Regression
  verifies both retry on invalid data and caching of valid self-only data.
- The runner no longer advertises an ignored viewpoint option; its real test uses
  the explicitly documented synthetic Berlin fix.

Controller/orbit regressions fail before each product fix and pass afterward. The eleven orbit/data
check groups (including the retained ISS reference-pass case), actual-controller
suite, 34 Python tests including both package builds, real-DOM browser checks and
architecture ratchet pass. Vendored JS builds and hashes are unchanged.

## Prior acceptance

Both [0.1.4](evidence/space-watch-0.1.4-staging-2026-09-27.json) and
[0.1.5](evidence/space-watch-0.1.5-staging-2026-09-27.json) passed separate complete
13-check runs and stopped cleanly. Late Codex review found stale identity after
refresh, then empty launch responses cached as no-companions. Their regressions
failed before each fix and passed afterward. 0.1.6 is a new signed package with
its own acceptance. No results are combined or waived. Earlier raw captures are
retained separately; the screenshots above are solely from the final version.

## Incomplete earlier runs

These are retained separately and are not combined into an acceptance pass:

- 0.1.0 attempt 1: 2 checks; attribution existed but the driver did not scroll to it.
- 0.1.1 attempt 2: 4 checks; driver expected `aria-pressed` in Android's checked
  field. Reopened screen was red; replaced the assumption with actual pixel checks.
- 0.1.3 attempt 3: 10 checks; unconditional Back after automated text entry opened
  Construct's menu because no keyboard was present. Driver now checks for a visible
  IME first. Landscape capture also now requires the complete square dome.

- 0.1.3 attempt 4: 11 checks; live CelesTrak data populated five overhead objects,
  but the new list moved the status outside the currently exposed accessibility
  viewport. The driver now scrolls to and asserts the final provider status.

- 0.1.4 attempt 5: 10 checks; driver inspected coordinate inputs before the
  opening dialog settled. Added a bounded wait for both identified inputs.
  Also tightened the live-status matcher (excluding Help text), enables master
  location before reopening, and requires real count labels rather than canvas
  descriptions for the live/offline assertions.

All five stopped the emulator cleanly. Module updates produced new immutable
versions; runner-only corrections did not change signed module or APK bytes.

## Limits

Android runs exercise the native menu with cached data; the in-flight-download
cancellation paths are covered by controller regressions, not claimed as device
injection tests. “Visible” is a geometric sunlight/dark-sky/elevation classification,
not a brightness/weather guarantee. Physical spotting accuracy, compass/follow mode,
and other phone models are not tested. No production-catalog promotion or PR merge.
