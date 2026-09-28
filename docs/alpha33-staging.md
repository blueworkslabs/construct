# Alpha33 camera and screenshot staging

**8/8 checks passed in one complete run**, with one explicitly recorded optional-tilt retake. Run `20260927T151743Z-capture-metadata-9506f749`; API 37 disposable synthetic-camera emulator. Complete/stopped true, independently inactive. Actual module and photo-dialog Recents captures reviewed: private contents hidden. No APK release has been published; #42 remains unmerged pending physical-phone feedback and final CI.

## Exact artifacts

- Host source: `f172276bfb4b191f08acff7fb148b3d3e057503d`.
- Driver: `2cca77813cbb2ef327da85ed4abbe59aff3a50ae`; fixture catalog [pinned signed index](https://raw.githubusercontent.com/blueworkslabs/construct/f8ee568ee0a0cb5d028759c08345de9a9afff495/catalog/candidates/capture-metadata/index.json). Probe 0.1.0 targets API 0.12; 0.2.2 targets API 0.13. All downloaded hashes/signatures verified. Prior fixture versions remain byte-identical.
- ARM64: `45437aafaf3e09f37a547c37665a675722a6e0429b5f5571dec0cf9748486376`.
- x86-64 (executed): `7d85825695ae7acc418d30c8ab8e5d376c1cb835196c3cca784f4fc08b46a77e`.
- Both signer certificates match alpha32, version code 33 / 0.1.0-alpha33; pinned publisher identity unchanged; size budgets and 16 KiB zip alignment pass.
- 231 JVM tests, lint, 89 runner-helper tests pass. Focused Codex re-reviews clear. CI for later driver/evidence commits is separate from the locally verified APK-source build.

## Observed behavior

Legacy API 0.12 rejects new request fields and retains the exact saved-only result and old viewfinder. API 0.13 reports IDs present in the real private library. Measured pitch +10/-10 and roll +10/-10 have correct signs; level is approximately zero. Accepted tilt sample ages are 160–197 ms, sigma 1–1.02 degrees. At 1x FOV is 39.97 x 51.73 degrees; at 2x it is 20.61 x 27.25, matching the tangent crop formula, with 1 degree FOV uncertainty. Heading is returned as magnetic; no real-world accuracy claim follows from an emulator.

Negative-roll capture first omitted tilt with heading age **254 ms**: a valid conservative omission above tilt's 250 ms bound. One recorded retake returned roll -10.02 degrees at 188 ms. The runner does not count absence as a sign pass, retry incorrect signs/values, or allow unexplained omissions. The raw receipt retains both observations and the bounded retake. All five poses ultimately supplied valid measured tilt.

Screenshot opt-in defaults off; enabling it allows foreground screenshots and persists across process restart. Disabling it restores blackout. The native viewfinder and private-photo confirmation remain secure. Actual Recents tiles are black for both a module and a native photo dialog on this Android 13+ device. The raw protected-viewfinder screenshot retains the Android camera privacy indicator: only recognized SystemUI edge bars are excluded by the classifier, never application pixels.

## Fixes and limits

Initial alpha33 bytes were not distributed: staging found a live Recents surface leak despite the snapshot-disable API. The final host restores FLAG_SECURE for unfocused/background sensitive opted-in modules, and separately secures native photo/diagnostic dialogs. It also preserves applied zoom-ratio precision. Earlier failed/incomplete runs are retained separately, not stitched into acceptance.

The five pose/viewfinder captures, native dialog, screenshot on/off, and both Recents images were reviewed. Capture controls are scrollable; the cancel control is below the initial fold. No large-text or landscape camera-layout pass is claimed. The crash buffer contains only the known emulator Bluetooth boot abort, not a Construct crash.

Physical camera geometry, magnetic accuracy, upgrade retention and vendor screenshot behavior remain phone checks. Unsupported or stale metadata is omitted, not guessed. Zero pitch means pointing the rear camera horizontally: a phone lying face-up/down is near +/-90 degrees, not zero. Aimé 0.1.9 remains usable on alpha33 but does not request level/zoom; the combined accuracy test needs Clawd's separate Aimé 0.2.0 update.

[Raw receipt](evidence/alpha33/acceptance.json) · [Phone checklist](alpha33-hardware-check.md) · [Level capture](evidence/alpha33/level.png) · [Protected Recents](evidence/alpha33/recents-module.png)
