# Reproduce the workflow

Start with a fresh checkout of this repository. No reference-lab account, endpoint,
private key or agent subscription is required. Agent orchestration is optional:
all build, publisher and emulator commands are ordinary scripts.

## 1. Local checks and build

Follow [building.md](building.md) for prerequisites, a new publisher identity,
complete synthetic fixture generation, local tests and an APK. Default builds use
system TLS trust and have no preconfigured remote catalog. The bundled Hello demo
works before you have a registry.

## 2. Candidate delivery

Publish signed packages into a dedicated candidate directory using
`scripts/publish_module.py` (see `--help`). `scripts/prepare_fixtures.py` also creates
a complete example home/test catalog pair under `dist/fixtures`. Package versions
are immutable: change the version when content changes. Never silently overwrite
a served version, and do not substitute newly built bytes after acceptance.

Serve only the catalog and ZIPs with `server/serve_registry.py`, behind your HTTPS
proxy. See its `--help` and `server/nginx-registry.conf.example`. The origin binds
loopback; it is not an authenticated public marketplace. Keep private signing
material and source/build trees outside the served directory.

Enter your HTTPS index URL under Construct menu → Settings → Use catalog (see
[using Construct](using-construct.md)), or create an ignored operator build profile
with `scripts/configure_host.py`. A private CA is optional and scoped to the exact
registry hostname. Certificate and hostname verification remain enabled.

## 3. Disposable Android acceptance

Provision a [configured runner](android-runner.md). Transfer the exact APK, record
its SHA-256, and provide expected module hashes to `runner.sh suite`. The suite
restores app-free snapshots, tests real controls and native providers, records
screenshots/structured receipts and stops the emulator on success or failure.

Review receipts and actual Android screenshots, including any excluded scopes.
Promote the exact accepted ZIPs to the normal catalog, then verify served hashes
and signatures with `scripts/check_registry.py --catalog HTTPS_INDEX_URL` (repeat
`--catalog` for multiple registries; optional `--ca-cert` for your public CA).
The pinned public key defaults to the asset generated during fixture preparation.

## 4. Human feedback

Install the candidate host on a test phone and download its modules. Reserve phone
checks for physical input feel, actual sound/camera behavior and vendor differences.
Do not treat a working emulator as evidence of all Android devices or all possible
malicious modules. See [evidence](evidence.md) and [release provenance](public-release.md).

## Module-owned Sky Watch

Run `node scripts/test_sky_map.cjs` for tile cancellation/retry behavior and
`node scripts/test_sky.cjs` for the actual shipped module's parsers, identity
merge, glossary and metadata contracts. `python scripts/prepare_fixtures.py` creates
a separate signed legacy launcher for native compatibility tests and signed
transport-scope versions for new-grant/update/rollback checks. Do not replace or
re-sign published module versions in a production catalog.

API 0.9 host checks include `HttpPolicyTest`, `ModuleHttpTest`, `ModuleLocationTest`
and `TransportAccessTest`; `CapabilityRetirementTest` covers management of retired
callers. Run `python scripts/check_architecture.py` to check the shell ownership
ratchet. Aviation behavior tests now live with the module, not native Sky code.
The migration also requires live exact-artifact Android checks and a separate
synthetic, signed module-only update demonstration on the same APK. JVM/Node tests
alone are not a completed migration or physical-phone acceptance.

## Retired capability transition (alpha28 candidate)

The configured disposable runner can execute `retirement.py --old OLD_APK
--old-sha OLD_SHA256 --new NEW_APK --new-sha NEW_SHA256 --candidates CANDIDATES_JSON`.
The old APK is alpha27; use exact file hashes. Candidate metadata contains `sky`
(version/SHA256 of published Sky 0.2.2) and `checklist` (version/SHA256 records for
published Checklist 0.1.0 and 0.2.0). Both hosts must trust the catalog publisher;
the configured public catalog is used for signed-package review. Normal runner
configuration, exclusive lock, app-free snapshot, pinned Android 17 WebView and
stop-on-exit rules apply. This script refuses an already-running emulator.

Run it again with `--checklist-only` for an independent clean-snapshot proof of
Checklist's added Clear completed workflow, retained data and supported rollback
on the identical candidate APK. Run the existing `--sky-module-candidates` suite
separately for live modern Sky behavior and its signed glossary update/rollback.
Record each completed scope independently and review the retirement UI screenshots;
partial runs are not acceptance. See [the retirement contract](shell-retirement.md).
