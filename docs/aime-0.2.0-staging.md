# Aimé 0.2.0 — measured camera inputs

**18/18 checks passed in one complete run**, `20260927T155622Z-aime-0113e1ea`, on exact signed 0.2.0 and unchanged alpha33. The runner and emulator stopped cleanly and were independently inactive. Combined physical-phone camera/accuracy testing remains a separate gate.

[Receipt](evidence/aime-0.2.0-staging-2026-09-27.json) · [Phone checklist](aime-0.2.0-hardware-check.md)

## Delivery

Module-only update on the unchanged accepted alpha33 APK (API 0.13). The APK's native capture, grants, screenshot protections and sensor timing are host-owned; Aimé owns metadata persistence, selection of usable inputs, calibration and search.

- Reviewed source: `bac5d1f`; immutable packages: `bcd003bd49e99da1e33e77af8e72678a5265091f`.
- Aimé SHA256 `00c213c4e3e9d6cb3000b57c32c8dbc4856353d1a1dc3d65d437ea6c929dc684`.
- Synthetic Aimé SHA256 `6499ad5692b65f4ce53f6e9eae4deaaff407fb4f52d6347b4f2f3b7515a03c4e`.
- Executed alpha33 x86-64 SHA256 `7d85825695ae7acc418d30c8ab8e5d376c1cb835196c3cca784f4fc08b46a77e`.
- [Pinned candidate catalog](https://raw.githubusercontent.com/blueworkslabs/construct/bcd003bd49e99da1e33e77af8e72678a5265091f/catalog/candidates/aime-020/index.json).

The existing publisher identity and downloaded signatures/hashes were verified. The separate 0.1.9 candidate catalog and its package bytes remain unchanged for alpha32. Alpha33's ARM64 phone APK is the previously supplied draft, not rebuilt for this module.

## Review and verification

45 module, 15 map and 31 solver checks pass, plus browser regressions, the signed-package test, 89 runner-helper checks and the architecture check. Reference and shipped solvers remain byte-identical. Codex reviewed the integration and re-reviewed the fixes.

The review corrected first-mark search on tilted photos: horizontal-column-only sorting could miss the true tapped ray by 45° in a steep-pitch reproduction. The temporary compass fit now uses the full solver ray and uncertainty without treating the photo as landmark-calibrated. The failing-before/passing-after browser regression covers this. Valid zero host compass accuracy now survives storage while retaining the 12° solver floor; exact applied zoom is preserved. Full-precision worst-case metadata remains within per-record bridge and storage limits.

The scale-at-pin/viewpoint latitude fix closes the implementation finding from #43, verified at separated latitudes. No new native feature is embedded in the module or host.

## Scope and limits

The synthetic fixture retains real host capture, stable IDs, storage, grants and deletion, but replaces capture measurements and pixels with a consistent scene. Those checks prove UI/solver integration, not physical sensor accuracy. A separate real Aimé capture on the accepted emulator requires actual level/lens/2× chips, live Hannover cells, a compass hint only after declination is available, and saved measurements after process restart. Missing chips are not counted as measured-input success.

Old/library photographs do not acquire shutter-time metadata retroactively. Missing/unreliable sensor or lens fields are omitted and fall back to the earlier calibration behavior. Heading is a weak magnetic hint corrected only when the viewpoint cell supplies declination. FOV is a sensor/lens estimate, not a surveyed calibration. The physical 1×/2× comparison, device-specific lens geometry and touch feel remain phone-test work.

Editing/saving in 0.1.9 after rollback can discard new capture metadata; versions 0.1.2 and older additionally cannot preserve cell-based marks. Do not offer these as data-preserving rollback paths for new photos.

Dataset `2026-09-23.1-r2` remains served. Its full 88-cell byte audit and retained-r1 evidence are recorded with 0.1.9; this run uses the public data path rather than a fixture for the real lookup. No public APK release, production-catalog promotion or merge is implied by acceptance.

## Final observations

Real Aimé returned 807 Hannover landmarks on the first attempt. Its native 2× capture showed Level measured and Lens from camera; live declination enabled Compass hint. Level/lens/zoom persisted after process restart. No retakes or network retries. Actual images reviewed: measured calibration, loupe, pin projection, landscape, 2× text, no-metadata fallback, real capture, live results and real restart.

The raw diagnostic chip arrays are empty because the original collector matched entire accessibility labels, while WebView groups the chips in a larger label. This did not weaken acceptance: separate substring assertions required each chip and the images show them. The receipt preserves that collection limitation. A reporting-only follow-up fixes future collection; the executed runner remains `bac5d1f`.
