# Shell cleanup: retiring the native Sky workspace

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

Run `python scripts/check_architecture.py`. CI rejects the known native Sky domain
classes/provider dependencies, new native workspace dispatches, unreviewed Activity
registrations and DEX loader introduction. This small source ratchet is a backstop,
not a semantic proof or a reason to evade ownership review by renaming code.
Camera and Measure are explicitly inventoried remaining exceptions.

Required candidate acceptance: JVM retirement/consent/rollback tests, lint, shipped
module tests and the architecture ratchet; exact-APK Android upgrade from alpha27
with a signed old Sky module; visible update guidance, fresh consent, preserved data,
retired install/rollback rejection, normal modern-module operation and supported
module update/rollback on the same APK. Review the actual transition UI in portrait,
landscape and large text. Do not attach alpha27 evidence to alpha28.

## Next extractions (not implemented by this change)

1. **[Measure (#26)](https://github.com/blueworkslabs/construct/issues/26):** module owns calibration/reference selection, units, endpoint edits,
   interpretation and screen flow. Specify bounded image acquisition and reusable
   detection/geometry results, opaque per-run image handles, cancellation and
   explicit pixel/data exposure before replacing `photo.measure`. Preserve current
   native image privacy until the new data-flow contract is implemented.
2. **[Camera (#27)](https://github.com/blueworkslabs/construct/issues/27):** module owns album and analysis presentation/workflow. Separate native
   shutter/permission controls, bounded capture/storage/export and reusable analysis
   from the application. Preserve existing private photos and deletion/export paths.
3. **Second independent consumer:** use an unrelated module to exercise existing
   generic facilities on the same frozen APK; change module behavior independently.
   Do not invent a large map/rendering API or downloadable DEX runtime for this proof.

These require their own implementations and exact-artifact evidence. Removing Sky
is not a claim that Camera/Measure are modular or that the complete shell is clean.
