# Pocket Measure — module-owned measurement

Pocket Measure **0.2.2** uses **API 0.10 / alpha29**. Its signed module owns
reference selection, calibration, projective geometry, endpoint editing, undo,
zoom/pan, units and UI. Generic native APIs select/decode one user-chosen image and
return bounded ArUco detections; the shell does not interpret lengths.

Install the compatible host and update the module through Browse. Explicitly allow
**selected image pixels** and **local marker detection** in native consent or
Module access. The old native measurement grant does not authorize pixels reaching
JavaScript. This module declares no internet, saved-data or diagnostic capability.
Pixels and results are transient; leaving/backgrounding discards the run. Rotation
and the native menu preserve completed work; interrupted edits are cancelled.

1. Print the [reference card](assets/pocket-measure-reference-A4.pdf) at actual size
   and measure its outer black square.
2. Choose one saved photo with that card and the item on the same flat plane.
3. Enter the measured marker side (10–300 mm), then tap A and B.
4. Drag endpoints or select A/B for one-image-pixel nudges. Undo reverses committed
   edits; Clear starts another pair. Pinch/zoom and pan; Reset view fits the image.
5. Choose centimetres or millimetres in the controls. These are approximate lengths,
   not a certified accuracy bound. No photo, calibration or measurement is saved.

See [the bounded image contract](module-images.md) for pixel disclosure, resource
bounds and retirement. Alpha28 is the last native Measure host. On alpha29 old
0.1.x packages remain manageable but need an update; rollback into the retired
native workspace is blocked without erasing data. No APK downgrade is promised.
The [alpha29 acceptance record](measure-module-alpha29-acceptance.md) covers the
exact optimized APK and signed 0.2.2 module, including independent updating.
Historical receipts below are not acceptance of the new module or physical phone.

## Historical native baseline (0.1.x / through alpha28)

The remainder describes the retired workspace, not current module/API behavior.

Status: implementation, local checks and exact optimized Android measurement
acceptance complete. Accompanying host/vision regression receipts are tracked in
[the review checkpoint](https://github.com/blueworkslabs/construct/pull/5).
Physical-phone placement and rotation checks passed through alpha 18. See the
[current placement UX and acceptance record](pocket-measure-slice1.md) for later
changes. Not an accuracy guarantee.

### User flow

Print the [A4 reference card](assets/pocket-measure-reference-A4.pdf) at actual
size, and check that the outer black square has equal measured width and height.
The printed size may differ from the nominal 100 mm; enter the actual size.

1. Install Pocket Measure and explicitly enable **Allow photo measurement**.
2. Open the native workspace and choose one saved photo using Android's picker.
3. The host detects DICT_4X4_50 marker ID 0. Confirm the actual measured outer
   black-square side in millimetres (10–300 mm; decimal point/comma supported).
4. Tap two endpoints. Read the approximate straight-line length in centimetres.
   Drag either endpoint to correct it, or select A/B to use the fine-adjustment
   arrows. **Undo** reverses the last edit; **Clear** removes the current pair so
   you can place a new one. Tapping after both endpoints are set does not start
   another measurement.
5. Pinch to zoom, pan while zoomed, and use **Reset** to fit the full photo above
   the collapsed controls. Rotation retains your current work; leaving the
   workspace or backgrounding the app discards it. Nothing is saved or exported.

Use a flat reference card beside an item on the same flat plane. A printer's
nominal scale is not calibration: measure the printed square. The v0 target is
rough centimetre-level usefulness, not a certified ±1 cm bound. Perspective,
marker corner localization, lens distortion, blur, endpoint selection, and
object height contribute error. Three exploratory real-photo views supported
feasibility, but those private photos are neither repository fixtures nor an
independent validation set. Fresh physical-photo checks remain necessary.

### Contract and boundaries

`photo.measure`, API 0.7.0, accepts only `{op:"open"}`. There is no URI/path,
marker size, endpoint, capture or export argument. Replies only acknowledge
opening. The capability is explicitly granted, off by default, and rechecked
before reads, result delivery and native interactions. Installed package digest
binds the activity to the launching module. No new Android permission is added.

The unexported native activity uses the system single-image picker, with the
platform document-picker fallback on older Android. It does not acquire broad
media access or persistent URI grants. Selected originals are read-only.
Processing and display stay native; pixels, URIs and measurements never reach
module JavaScript or diagnostics. This slice saves/exports nothing. Rotation
retains the in-memory photo, calibration and measurement while resetting the
viewport to fit. Actual backgrounding and process recreation discard the workspace.
Explicit picker handoff is the sole background exception. Pending work is
generation-checked and serialized.
The working bitmap is bounded to 1600 pixels on its longest side; reads are
limited to 20 MiB and source dimensions to 12000 pixels per side.

OpenCV 4.12.0 performs local ArUco detection; the model-free detector uses
only DICT_4X4_50 ID 0 and rejects missing or duplicate target markers. At least
40 working-image pixels per edge are required. Pure Kotlin solves a homography
and rejects invalid/nonconvex quadrilaterals, projective horizons, invalid scale,
non-finite values, coincident endpoints and out-of-photo taps. Image coordinates
are normalized; fit/letterboxing is shared by rendering and input.

### Reproduction and evidence

- `python scripts/prepare_fixtures.py` signs the example launcher with the local
  independent fixture key. This includes the example in home/test catalogs.
- `node scripts/test_measure.cjs`: explicit launch only, minimal bridge parameters,
  denial/retry, actual script/bridge compilation.
- `MeasureTest`: independent forward-perspective fixture, rotated corner ordering,
  actual-versus-nominal marker size, malformed geometry and letterboxed input.
- `MeasureAccessTest`: API minimum, default-denied/persisted revocation and strict
  rejection of caller-controlled URI/size/measurement arguments.
- `examples/measure-fixtures`: generated flat/angled 240 mm references and
  blank/duplicate-marker negative controls. These are entirely synthetic,
  MIT-licensed and SHA-256 locked. Regeneration instructions are in that folder.
- Copy that folder to a configured disposable runner as `measure-fixtures`, and
  publish Pocket Measure 0.1.2 into its test catalog. Run
  `runner.sh suite APK SHA256 --measure-only --measure-sha256 MODULE_SHA256`.
  Use the documented pinned WebView provider if the original emulator provider
  has the known accessibility issue. No physical-device ADB is supported.
- Android acceptance must exercise the real picker, offline first-use detection,
  the known endpoint length and changed marker size, perspective, negative
  controls, closure, revocation, unchanged original bytes and diagnostic privacy.
  Host baseline and existing native vision checks are separate receipts.

Alpha 16 builds a narrow native bridge from pinned OpenCV source and produces
separate ARM64-phone and x86-64-emulator APKs instead of shipping the full multi-ABI
Java/native package. See [building](building.md) and
[third-party provenance](../third_party/README.md). No runtime downloads, OpenCV
Manager, unrestricted module networking or automatic object recognition are added.

The [capability-pack proposal](capability-packs.md) describes a future small-core
direction; it is not an implemented native plugin downloader.

### Integration notes

The selected photo's display rectangle is reserved across endpoint taps: status,
result and clear-control space do not appear/disappear between A and B. Android
acceptance checks unchanged canvas bounds after each endpoint, in addition to the
numeric result, so a driver cannot silently compensate for a jumping photograph.

An early exploratory fixture driver rewrote one PNG/media URI with successive
images, including a differently oriented JPEG. That yielded an incorrect rotated
fixture result. The corrected driver verifies each original's bytes, removes
only that generated media row, then inserts a distinct file with the right
extension and a fresh URI. With that correction the unchanged measurement code
passed flat, angled and EXIF-oriented 240 mm controls. Those exploratory receipts
remain separate from final candidate acceptance; no real-camera accuracy claim
is inferred from them.

### Historical alpha 15 optimized measurement acceptance

Candidate source `5d86ce9`, host `0.1.0-alpha15`, universal APK 197794762 bytes:
`1ea3d7bab2f2ff0e59ad99c62ff3255721760707495abd16c3b34e7f58f9fffc`.
Pocket Measure 0.1.2 package:
`645b93933776e8b6b4177d34f57e098b5fb471b21899c6eccd64bb75e9abca74`.

- 105 JVM tests pass; lint has no errors (17 warnings). Publisher/configuration
  Python checks: 20; runner contract tests: 43; measurement launcher checks: 3.
- Run `20260914T111230Z-3556c6a0`: all **13 native measurement checkpoints**
  passed on Android 16 / the pinned WebView 155 provider. Flat, independent
  perspective and EXIF-oriented synthetic references each displayed **24.0 cm**;
  entering 95 mm instead of 100 mm gave **22.8 cm**, as expected. Canvas bounds
  remained unchanged after every A/B tap. First detection occurred offline.
- Cancellation and invalid marker size are handled. Blank/duplicate-ID images
  cannot enable measurement. Backgrounding and rotation close and clear it;
  revoked access denies reopening. Original bytes remain unchanged, and photo
  details/measurement results are absent from Construct diagnostics.
- Suite completed and stopped the emulator. This result contains no diagnostic
  exclusions; earlier failed/diagnostic APK runs are not counted as acceptance.
- App signing identity, bundled publisher/demo/vision assets and Android
  permissions are unchanged. The OpenCV native libraries match the official AAR;
  APK 16 KiB ZIP alignment verifies. The universal installer is approximately
  **198 MB**, due to the full multi-ABI native OpenCV runtime.

These synthetic controls validate the implementation, not physical-camera
accuracy. The physical-phone check is selection/overlay usability and approximate
lengths on real flat objects, using the actual printed marker side.
