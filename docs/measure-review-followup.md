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
