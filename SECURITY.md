# Security model and reporting

Construct is an experimental alpha runtime, not a hardened general-purpose
sandbox for arbitrary hostile publishers. Signatures establish publisher provenance;
they do not certify module behavior. Read [the architecture](docs/architecture.md)
and [evidence limits](docs/evidence.md) before expanding trust or device access.

## Boundaries to preserve

- Native code checks module origin, manifest declarations, user grants and relevant
  Android permission. Sensitive asynchronous replies are checked/invalidated at
  delivery, not merely when a request starts.
- Modules do not choose raw provider URIs, arbitrary SQL, filesystem paths or camera
  streams. Native permission UI and controls must not be imitated by module HTML.
- Reject damaged/incompatible packages and unsafe archive paths before activation.
  Keep a known working version and honest trial/rollback state.
- Keep signing material, real contacts/photos, credentials and raw private test
  receipts out of source, public issues and build artifacts.
- Do not expose emulator/ADB control ports. Test fixtures are for disposable,
  synthetic-data environments, not a user's live phone.

## Reporting a suspected vulnerability

Use [GitHub private vulnerability reporting](https://github.com/blueworkslabs/construct/security/advisories/new).
If that route is unavailable, do not place exploit details or personal data in a
public issue; open a non-sensitive request for a private reporting route instead.

A useful report identifies the affected source/version, boundary crossed, minimal
synthetic reproduction and expected versus observed result. Never attach signing
keys, real contact records, personal photos or unredacted diagnostics.

Known camera direct-Reopen accessibility and the limits of bounded isolation probes
are documented openly; neither is represented as a completed security guarantee.

### Historical Sky Watch native workspace (alpha23–alpha27)

API 0.8.0 introduced an explicit `sky.watch` open-only grant. Through alpha27, its
native foreground map could query fixed aircraft/map services after a human chose
an area. Optional coarse/fine phone location was requested only from a native
human control. Module JavaScript received no location, aircraft data or map pixels
and retained its existing network/geolocation denial. No background location
permission was added. See [the historical privacy contract](docs/sky-watch.md).

Alpha28 removes that native implementation and retains `sky.watch` only as a
historical identifier for recognizing old manifests. Existing required callers
need a module update; execution, new installation and rollback to required callers
are blocked while saved module data is retained. The old grant does not authorize
the modern module's HTTP or location access. See
[retirement and rollback handling](docs/shell-retirement.md).


### Module HTTP and location (API 0.9)

`net.http` is a separately granted, signed-origin-scoped HTTPS GET capability;
`location.read` returns one foreground fix after independent module and Android
permission checks. The host checks actual DNS connection addresses, TLS, formats,
byte/pixel bounds, quotas and asynchronous authority. Redirects, cookies and caller
headers are unavailable. Direct WebView network/geolocation remains disabled.
See [the precise contract and limits](docs/module-api.md).

Module code can combine legitimately granted data: network plus location/contacts
can send that data to approved origins; storage can retain it. Source expansion
requires fresh consent. Host enforcement limits authority, not application intent;
signed modules still require review. Revocation blocks future authorized access,
not copies already delivered. The new Sky module documents its narrower intended
usage; those product promises must not be mistaken for universal host guarantees.

### Selected images and marker detection (API 0.10 / alpha29)

`image.read` gives module code a bounded, orientation-correct raster of one image
chosen in Android's picker. `image.markers` returns bounded generic detections and
also requires current image-read authority. Handles are per-run, not file paths;
original metadata is stripped. Grants are explicit and off by default. Old
`photo.measure` consent never authorizes these pixels; that native workflow ends
at alpha28 and is retired in alpha29.

Network, storage or diagnostic grants may let a module send or retain data it has
received. Revocation cannot erase copies already delivered. Pocket Measure's lack
of those capabilities is a module choice, not a universal host promise. Native
picker handoff (API 0.10+) and tracked native capture handoff (API 0.11) are
explicit exceptions; unrelated background exits end the run. See [bounds, lifecycle and compatibility](docs/module-images.md).


### Private photos and local inference (API 0.11 / alpha31 candidate)

The former `camera.capture` workspace ends at alpha30. Alpha31 retains only its
historical identifier and update-required recovery, not execution or authority.
Existing per-module private originals are retained. The old grant cannot authorize
pixels, an album listing, capture through the new API or analysis results.

Fresh `photos.library` plus `image.read` grants expose bounded copies of this
module's existing private photos through opaque run refs. `camera.photo` allows
only a visible native human shutter (also requiring Android CAMERA). Separate
`image.analyze` plus image/source authority allows bounded still-photo inference.
No live frames, filesystem paths, general gallery permission or new models are
exposed. Human deletion/export needs trusted confirmation showing the selected
photo, with current session/digest/grants rechecked at final publication. A late
confirmation after close or revocation cannot mutate the original.

The acquired raster retains source authority for later stream reads and inference
delivery. Analysis and displayed pixels are transient; original files survive
updates and supported rollback. Native host deletion remains available when
access is off or the installed module needs an update. Network/storage grants can
permit a module to transmit/retain delivered pixels; Camera itself requests none.
See [full bounds and lifecycle](docs/module-photos.md). Emulator/debug timing is
not a physical-phone smoothness or continuous-video guarantee.
