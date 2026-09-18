# Measure review follow-up and UX handoff

PR #28 review follow-up, after the published alpha29 / Measure 0.2.2 pilot.
That pilot and its [acceptance record](measure-module-alpha29-acceptance.md) remain
immutable. They are not device acceptance of the changes below.

## Review corrections

- The module bridge no longer times out the human-operated image picker. Selection
  or cancellation after a long wait settles the original request. Noninteractive
  calls retain their 20-second module timeout; native decode/detection retain the
  separate 15-second processing deadline. Session teardown remains authoritative.
- Host, publisher and manifest schema require an `image.read` declaration whenever
  `image.markers` is declared, including optional marker access and either order.
  Image selection without marker detection remains valid. Both live grants remain
  necessary for detection; declarations never grant access.
- Source versions advance to **host alpha30** and **Measure 0.2.3**. These are
  unpublished development versions; do not overwrite alpha29 or signed 0.2.2.
  The picker fix itself uses the existing API 0.10 and can run on alpha29. A new
  host is needed to ship the stricter native manifest validator.

## Fable UI/UX pass

Improve module-owned layout, interaction and rendering efficiency, with a restored
precision magnifier for endpoint placement and dragging. Use the already delivered
bounded raster/Canvas; do not restore native measurement logic or expand grants.

The magnifier should reveal the actual image under the endpoint with a clear
crosshair, remain visible away from the finger and host menu, handle edges and
zoom/pan without changing photo coordinates, and disappear on completion or
interruption. Initial placement and later endpoint adjustment both need coverage.
Keep fine nudges, transactional Undo and accessible non-drag controls. Avoid
unmeasured performance claims or speculative frameworks.

Verify portrait/landscape, large text, stable canvas bounds, touch/pointer
cancellation and multi-touch, and ensure the overlay never selects or moves an
endpoint by itself. Use real synthetic Android screenshots and exact signed
module/APK evidence for the final candidate. Carry the review corrections forward;
repeat relevant lifecycle, consent and independent-update checks after changes.

No merge or replacement pilot has been authorized by this handoff. Final packaging,
version provenance and exact-artifact acceptance must precede release claims.

## Local verification of review corrections (before UX acceptance)

Host source `40db18c`: **175 JVM tests pass; lint has zero errors**. Module tests
pass **21/21**, including simulated selection/cancellation after 30 minutes and
bounded noninteractive requests. Publisher/script tests pass **31/31**; schema
dependency checks cover both optional flags, declaration orders and read-only
modules. The new picker tests and publisher dependency cases failed before the
fixes. Architecture and whitespace/link checks pass.

No new optimized APK or signed 0.2.3 package was published for these corrections.
The next combined UX candidate still requires exact-artifact Android verification;
alpha29's completed device evidence does not cover alpha30 or the upcoming UI.

Historical loupe reference: `MeasureOverlay.kt` at commit `65f6cc5` used a 96 dp
circle, 2.5× image magnification and 72 dp offset, flipped/clamped at edges with
a contrasting crosshair. Treat these as reference behavior, not fixed dimensions
for a responsive WebView implementation.

## Combined UX candidate acceptance — 2026-09-18

The source reservation above was followed by Fable's module-only magnifier/UX pass
and Android verification. The accepted test candidate is **alpha30 + Measure
0.2.5**; intermediate 0.2.3/0.2.4 packages were not accepted. Final scopes passed
**19/19 functional** and **2/2 signed module update/rollback** on identical APK
bytes, with actual normal/2×-text and magnifier captures reviewed. See the
[exact-artifact record and limits](measure-loupe-alpha30-acceptance.md).

This is candidate evidence only: neither PR has been merged, no replacement APK
pilot has been released, and the production catalog is unchanged. Phone acceptance
remains separate from the emulator results.
