# Aimé 0.2.1 — accuracy follow-up on alpha33

**18/18 Android checks passed in one complete run**, `20260927T175347Z-aime-cedcab79`, on signed 0.2.1 and unchanged alpha33. The runner and emulator stopped cleanly and were independently inactive. Screenshots were visually reviewed. Ready for the saved-photo hardware comparison; physical accuracy is not established by this run.

[Receipt](evidence/aime-0.2.1-staging-2026-09-27.json) · [Phone checklist](aime-0.2.1-hardware-check.md)

## Delivery boundary

This candidate updates only the signed Aimé module. Native capture and privacy remain supplied by the unchanged accepted alpha33 APK. Although PR #44 is stacked on the proposed alpha34 source, that new APK is not used or cleared by this run. Module source `5c42a46`; immutable package commit `426216024036a9dbf78770c38ddeed2d97e4ffc9`.

- Aimé SHA256 `b92e19be370c923514823a1b8581808acf75b3b22628cfacb509c632d4a50069`.
- Synthetic Aimé SHA256 `df6c6aedac1b048f67aeb505ae832cf336a91e363b7cc2d6942da5bbbb218bb1`.
- Executed alpha33 x86-64 SHA256 `7d85825695ae7acc418d30c8ab8e5d376c1cb835196c3cca784f4fc08b46a77e`.
- [Pinned catalog](https://raw.githubusercontent.com/blueworkslabs/construct/426216024036a9dbf78770c38ddeed2d97e4ffc9/catalog/candidates/aime-021/index.json).

Downloaded package hashes and signatures match the existing publisher identity. Earlier candidate catalogs remain unchanged.

## Review

48 core, 15 map and 31 solver checks pass, plus browser regressions, signed-package and architecture checks and 89 runner helpers. Reference and shipped solver copies remain byte-identical. Independent review is clear after the details-panel layout correction: valid long names previously squeezed residuals to 12 px or pushed them outside the dialog. Bounded columns and wrapping pass the failing-before/passing-after browser regression for realistic and maximum-length labels; focused re-review is clear.

The zoom-aware default is a prior, not a camera measurement. It uses stored zoom when a usable lens measurement is absent, allowing an existing 2× photo to be recalibrated without a new capture. Calibration details separates raw inputs and skip reasons from fitted values, and shows landmark uncertainty/residuals. Existing marks and camera measurements are preserved; a later dataset does not silently replace saved landmark coordinates.

## Separate blockers and limitations

Alpha34 is held for an off-centre crop representational error: an angular span alone does not describe an off-axis image under the consumer's centred projection. [Reproduction](https://github.com/blueworkslabs/construct/pull/42#issuecomment-5858300575). This does not establish that the Pixel used such a crop.

The proposed r3 data is held because its nearest-tall-building rule relocates VW Tower/Telemoritz onto the distinct Hochhaus Lister Tor. [Review and independent identity sources](https://github.com/blueworkslabs/aime-data/pull/3#issuecomment-5858265630). Existing r2 remains unchanged; the old VW Tower point is close to documented Telemoritz coordinates, not proven 135 m wrong.

Synthetic UI/solver tests do not prove physical sensor accuracy. The real-module step uses native 2× capture and public Hannover cells, but Pixel-specific lens acquisition and the saved-photo bias comparison remain hardware work. An omitted lens cannot be recovered retroactively. No alpha34 release, r3 publication, PR merge or production-catalog promotion is implied.

## Final observations

Real 2× capture showed Level measured, Lens from camera and 2× zoom. The public Hannover lookup returned 807 landmarks on the first attempt, then Compass hint appeared with declination. Level/lens/zoom survived process restart. No retakes or network retries on the real path. The synthetic error-recovery step deliberately injects one unavailable response and uses its single recorded retry.

Eleven final-package images reviewed: measured and missing-lens details, calibration, held magnifier, map-pin projection, landscape, 2× text, outside coverage, real capture, live landmarks and real restart. Long-name containment is a browser regression, not an additional Android assertion. The 2× missing-lens prior is covered by module/browser checks; the Android missing-lens fixture uses 1×. Native Pixel multi-camera FOV acquisition remains unverified by this module run.
