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
