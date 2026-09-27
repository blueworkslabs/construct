# Aimé 0.2.2 — fresh-photo follow-up on alpha34

**18/18 Android checks passed** in complete run `20260927T201108Z-aime-5cc43e23`, on the exact final alpha34 APK. Complete/stopped true; suite and emulator independently inactive, emulator exit success. Ready for a bounded Pixel hardware test, not a physical-accuracy guarantee.

[Receipt](evidence/aime-0.2.2-staging-2026-09-27.json) · [Phone checklist](aime-0.2.2-hardware-check.md) · [Host acceptance](alpha34-staging.md)

## Exact independent artifacts

- Module source `12771d4`; package commit `bc34cff1a6b7c1d245ae108dd7087b89358aca9d`.
- Aimé SHA256 `13943529480f5d9be769be659e2b6a7353813e85df8d79d42999255c25b19b64`.
- Synthetic Aimé SHA256 `ceb5f11cbb36952392b6c33f79aae77c524d66cd37c0138d5501530209fbcfbb`.
- Executed alpha34 x86-64 SHA256 `990f178d0516f4d0797b98d12c62da3813d665087e725a464ec7300851b65dbc`; host source `e131830`.
- [Pinned signed catalog](https://raw.githubusercontent.com/blueworkslabs/construct/bc34cff1a6b7c1d245ae108dd7087b89358aca9d/catalog/candidates/aime-022/index.json).

The host owns bounded capture, metadata acquisition and privacy; downloaded Aimé owns calibration, landmark data, editing and diagnostics presentation. No Aimé code was moved into the APK. Downloaded module signatures and hashes match the established publisher. Earlier catalog/package versions remain unchanged. Both downloaded APKs match the separately verified local builds and unchanged signer.

## Review and module changes

52 module, 15 map and 31 solver checks pass, plus browser regressions, package/architecture checks and 89 runner helpers. Reference/module solver files remain byte-identical. On opening a photo with compass metadata, the current viewpoint cell is downloaded without requiring a landmark search. A review fix refreshes an already-open Calibration details panel when delayed declination arrives; its regression fails before and passes after. Missing/denied data never invents declination.

The zoom-aware fallback remains a prior, never labelled a camera measurement. Outside-reference hints tell the user to add a mark on the relevant side (or a second mark); they are a placement heuristic, not a physical accuracy guarantee. A newer same-name/same-kind nearby record can be explicitly applied from Calibration details, with one write and Undo. Coordinates never silently refresh. That update/undo path is browser-tested, not a claimed additional Android acceptance step. Unchanged r2 saved marks normally have no update offer.

## Host and data boundaries

The new host safely omits unsupported off-centre crop geometry and its axis-dependent pose fields. The separate exact-APK host run passes 8/8 and visual privacy review; it exposed and corrected a live Recents leak in code shared with alpha33. Earlier alpha33 black images were insufficient proof. The final host run had zero retakes; its receipt records actual Recents images and a teardown-only emulator abort after checks. The module run below shut down cleanly. Physical Pixel logical-camera FOV availability and slow/cancelled app-switch gestures remain phone checks.

Dataset remains `2026-09-23.1-r2`, publication `a9afc6ec1b46c2fefbe32f12b4e050dbceeb02eb`, with prior full 88-cell audit and retained r1. Proposed r3 remains held: generic power plants must not become chimneys without stack evidence, and contextual plant names must not collapse distinct stacks. The mistaken VW Tower→Lister Tor proximity rule has been removed from the proposal; no such move was published.

Existing photos cannot acquire lens metadata omitted at their original capture. No accuracy improvement is guaranteed by emulator results. No merge, public release or production-catalog promotion is implied.

The first 0.2.2 run on host af57ff9 stopped after 17 checks at a required real-capture measurement chip; it is incomplete, with clean shutdown. The driver now records the exact missing chip and Calibration details on failure. No assertion was relaxed. That run is not combined with the final run.

Remaining non-blocking pilot limits are tracked: map capture-loss cleanup [#45](https://github.com/blueworkslabs/construct/issues/45), host capture/compatibility edge cases [#46](https://github.com/blueworkslabs/construct/issues/46), and stricter evidence for any future host-runner retakes [#47](https://github.com/blueworkslabs/construct/issues/47). Final host run had zero retakes; the module runner never waives a missing required chip. No general-release clearance is implied.

## Final observations

Real 2× capture showed Level measured, Lens from camera, Compass hint and 2× zoom. Public Hannover lookup returned 807 landmarks on the first attempt. Measurements persisted after process restart. No real-capture retakes or live-network retries. Ten selected final-run screenshots reviewed: pre-lookup/marked/missing-lens details, loupe, pin, landscape, large text, real measured photo, live landmarks and restart. Only the known emulator Bluetooth boot abort appears in the guest crash buffer, not a Construct crash. The first incomplete module run remains separate and is not counted toward this pass.
