# Shell cleanup: retiring native application workspaces

## Delivery and boundary

The alpha28 candidate removes the APK-bundled Sky Activity, networking, data,
identity, metadata and map implementations. Sky Watch 0.2.2 remains the same signed
module; no module bytes, provider contract or native authority are added. API 0.9
HTTP, location and storage remain its only host dependencies. This is a host update
because it removes native code and introduces lifecycle handling for retired
capabilities, not because an aircraft feature changed.

Alpha27 was the compatibility bridge release. Its recorded acceptance includes
old-to-new module migration, fresh consent, retained data and independently signed
module update/rollback on the same APK. See the [exact-artifact evidence](evidence/modular-sky-alpha27-2026-09-17.json).
Those results are prerequisite evidence, **not** acceptance of the new alpha28 APK.

## Explicit compatibility boundary

- `sky.watch` is retired in alpha28. The identifier is retained in a historical
  capability registry solely to read and manage old signed manifests and grants.
  There is no native implementation or bridge dispatch behind it.
- An already-installed module requiring it remains visible in Library as **Update
  required**, not damaged. Its code, saved module data and catalog choice are not
  deleted. **Find update** refreshes the user's selected catalog; installation is
  still an explicit signed-package review with normal consent.
- Sky Watch users should update to 0.2.2 or later. There is no automatic package
  download/install on startup, substituted module code or hidden network grant.
  The old native grant cannot authorize HTTP or location access.
- Existing unconfirmed retired trials may be replaced by a supported version;
  users are not required to execute or mark retired code working first.
- New installation, execution and confirmation of a module requiring a retired
  capability are rejected. Rollback to such a version is rejected **before any
  state mutation**. Current supported code, grants, previous reference and data
  stay intact. Rollback between supported versions retains the normal contract.
- Optional retired capabilities do not block the rest of a module, but calls and
  attempts to grant them return `CAPABILITY_RETIRED`. Unknown capability IDs are
  still rejected; the historical registry is not a general allowlist bypass.
- A custom catalog must carry a supported replacement. If it does not, users may
  choose another trusted catalog or remove the old module while keeping its data.
  Alpha27 remains the last release with the old native workspace. Do not advise
  uninstalling Construct or promise a data-preserving Android APK downgrade.

This intentionally ends the alpha27 promise of native Sky rollback. Compatibility
means preserving a documented upgrade path, not retaining the old application
inside every future APK. Historical release evidence and signed packages remain
immutable; they describe the releases on which they were tested.

## Enforcement and acceptance

`CapabilityLifecycle` separates historical identifiers from executable capabilities.
The store enforces install, run, grant, confirmation and rollback boundaries, and
the Activity/WebView check the runtime boundary again. Library provides a recovery
path even when an old trial cannot run.

Run `python scripts/check_architecture.py`. CI rejects known native Sky, Measure and Camera domain
classes/provider dependencies, new native workspace dispatches, unreviewed Activity
registrations and DEX loader introduction. This small source ratchet is a backstop,
not a semantic proof or a reason to evade ownership review by renaming code.
Camera was the remaining exception through alpha30. The alpha31 candidate
removes that exception; its distinct acceptance remains required.

Required candidate acceptance: JVM retirement/consent/rollback tests, lint, shipped
module tests and the architecture ratchet; exact-APK Android upgrade from alpha27
with a signed old Sky module; visible update guidance, fresh consent, preserved data,
retired install/rollback rejection, normal modern-module operation and supported
module update/rollback on the same APK. Review the actual transition UI in portrait,
landscape and large text. Do not attach alpha27 evidence to alpha28.

## Extraction roadmap after alpha28

1. **[Measure (#26)](https://github.com/blueworkslabs/construct/issues/26):** implemented
   in the alpha29 candidate below. Module owns geometry, calibration and screens;
   the host provides bounded image acquisition and marker detections with fresh
   consent for pixel exposure. Candidate verification remains a separate gate.
2. **[Camera (#27)](https://github.com/blueworkslabs/construct/issues/27):** module owns album and analysis presentation/workflow. Separate native
   shutter/permission controls, bounded capture/storage/export and reusable analysis
   from the application. Preserve existing private photos and deletion/export paths.
3. **Second independent consumer:** use an unrelated module to exercise existing
   generic facilities on the same frozen APK; change module behavior independently.
   Do not invent a large map/rendering API or downloadable DEX runtime for this proof.

Each extraction needs its own exact-artifact evidence. Alpha28 Sky evidence does
not establish alpha29 Measure acceptance, and the alpha31 Camera candidate needs its own evidence. The
Checklist proof recorded with alpha28 demonstrates an unrelated independent
consumer; it is not a substitute for Measure-specific update/rollback checks.


## Measure retirement (alpha29 candidate)

After the module-owned picker/measurement prototype passed, the alpha29 candidate
removes the seven native Measure workflow/geometry/UI classes, Activity and bridge
dispatch. Generic bounded image selection/decoding and marker detection remain;
ID selection, calibration, endpoints, units and interpretation do not.
`photo.measure` is retained only as a historical API 0.7+ identifier. Installed
0.1.x packages receive the same data-preserving Update required / Find update
handling described above. New installs and rollback into the retired workspace
are blocked. The native workspace itself never saved measurements or photos.

Pocket Measure 0.2.2 requires API 0.10 and two new explicit image grants; old native
measurement consent must not be inherited. Alpha28 is the final native Measure
host. [Optimized-candidate acceptance](measure-module-alpha29-acceptance.md) covers
functional/lifecycle checks, this in-place transition and independent module
updating; the earlier debug prototype remains separate. See [the image contract](module-images.md) and
[the modern user flow](pocket-measure.md). Camera remained the native exception through alpha30.


## Camera retirement (alpha31 candidate)

The replacement module owns album navigation, selected-photo interpretation,
detection lists/Canvas overlays, score filtering and ordinary feature controls.
The candidate removes `CameraActivity`, its manifest/dispatch entry and obsolete
native album-overlay state. Native code retains reusable capture, bounded private
storage, trusted deletion/export confirmation and local inference. There is no
continuous frame/video stream into JavaScript; this migration tests the existing
saved-photo behavior, not a newly invented live-vision application.

`camera.capture` is historical API 0.4+ metadata only. Alpha30 is its last native
host. Existing required callers show Update required / Find update, including
unconfirmed trials. Old manifests/data remain manageable; new installation,
execution, regrant and rollback into the retired workspace fail explicitly.
`camera-photos/<module-id>` originals and unrelated saved data remain untouched.
Native Module access still offers confirmed **Delete all saved photos** when
private originals exist, even for an update-required module with no active grants.

Modern Camera 0.2.x requires API 0.11. The old workspace grant cannot authorize
`camera.photo`, `photos.library`, `image.read` or `image.analyze`; all need fresh
independent consent. Android camera permission is still separate. Private-library
consent expressly includes older captures. Supported module updates/rollback
preserve originals and do not reverse grant revocation. See [photo contracts](module-photos.md).

This is a retirement **candidate**, not final device acceptance. Before promotion,
require an in-place alpha30 upgrade with a real synthetic native-shutter photo,
byte preservation, fresh consent, rejected native rollback/reinstall, functional
capture/inference/export/lifecycle checks and a supported signed module update
and rollback on unchanged APK bytes. Retain failed/incomplete attempts separately.
