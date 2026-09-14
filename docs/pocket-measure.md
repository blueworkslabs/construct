# Pocket Measure prototype

Status: implementation and local checks complete; exact optimized Android
acceptance and physical-phone acceptance pending. Not an accuracy guarantee.

## User flow

1. Install Pocket Measure and explicitly enable **Allow photo measurement**.
2. Open the native workspace and choose one saved photo using Android's picker.
3. The host detects DICT_4X4_50 marker ID 0. Confirm the actual measured outer
   black-square side in millimetres (10–300 mm; decimal point/comma supported).
4. Tap two endpoints. Read the approximate straight-line length in centimetres.
   Clear endpoints or tap again to start another measurement.

Use a flat reference card beside an item on the same flat plane. A printer's
nominal scale is not calibration: measure the printed square. The v0 target is
rough centimetre-level usefulness, not a certified ±1 cm bound. Perspective,
marker corner localization, lens distortion, blur, endpoint selection, and
object height contribute error. Three exploratory real-photo views supported
feasibility, but those private photos are neither repository fixtures nor an
independent validation set. Fresh physical-photo checks remain necessary.

## Contract and boundaries

`photo.measure`, API 0.7.0, accepts only `{op:"open"}`. There is no URI/path,
marker size, endpoint, capture or export argument. Replies only acknowledge
opening. The capability is explicitly granted, off by default, and rechecked
before reads, result delivery and native interactions. Installed package digest
binds the activity to the launching module. No new Android permission is added.

The unexported native activity uses the system single-image picker, with the
platform document-picker fallback on older Android. It does not acquire broad
media access or persistent URI grants. Selected originals are read-only.
Processing and display stay native; pixels, URIs and measurements never reach
module JavaScript or diagnostics. v0 saves/exports nothing. Other backgrounding,
rotation and process recreation close the workspace. Explicit picker handoff is
the sole background exception. Pending work is generation-checked and serialized.
The working bitmap is bounded to 1600 pixels on its longest side; reads are
limited to 20 MiB and source dimensions to 12000 pixels per side.

OpenCV Android 4.12.0 performs local ArUco detection; the model-free detector uses
only DICT_4X4_50 ID 0 and rejects missing or duplicate target markers. At least
40 working-image pixels per edge are required. Pure Kotlin solves a homography
and rejects invalid/nonconvex quadrilaterals, projective horizons, invalid scale,
non-finite values, coincident endpoints and out-of-photo taps. Image coordinates
are normalized; fit/letterboxing is shared by rendering and input.

## Reproduction and evidence

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

The upstream full multi-ABI OpenCV runtime increases the installer size. See
[third-party provenance](../third_party/README.md). No runtime downloads, OpenCV
Manager, unrestricted module networking or automatic object recognition are added.
