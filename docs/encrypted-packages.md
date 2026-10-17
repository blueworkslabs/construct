# Encrypted packages — design proposal

Status: **draft for review, not implemented or approved for release** (2026-10-17).
This note specifies a generic host-owned installation feature. It does not add a
module bridge capability, change the runtime sandbox, or authorize publication of
any particular payload. Existing private test delivery remains unchanged.

## Purpose and ownership

Host encrypted module artifacts on an ordinary public static catalog, while
distributing their unlock keys privately. The installed Construct APK is the
trusted decryptor; the catalog server supplies bytes, not executable loader code.

- **Host:** package authentication/decryption, native key entry and storage,
  manifest validation, install consent, lifecycle enforcement and cleanup.
- **Module:** all application code, assets, domain behavior and ordinary UI, inside
  the encrypted package. No application-specific host code or bundled payload.
- **Publisher:** build, encrypt and sign immutable artifacts locally; keep keys,
  plaintext build outputs and deployment profiles outside public repositories.

Delivery requires a host APK update and publisher tooling. Subsequent encrypted
module versions update independently on that same APK. This is package format
negotiation, **not** a new `constructApi` version; the inner manifest continues to
declare the runtime API it actually uses. The [modular design contract](modular-design.md),
[module API](module-api.md), [catalog rules](public-catalog.md) and
[architecture](architecture.md) remain authoritative for ordinary modules.

## Security and disclosure contract

Only ciphertext and an opaque listing may be public. No real module name,
description, icon, recognizable identifier, asset filename or screenshot belongs
in the public index, artifact path, release notes or test fixtures. The real
manifest is encrypted and shown locally only after successful unlock/validation.
Use neutral labels such as “Locked module”; a stable random opaque identifier
links versions without describing the application.

Public observers can still see artifact length, version, update/access timing,
opaque identity and traffic metadata. Padding and anonymous transport are out of
scope. Encryption does not grant distribution rights and is not DRM. A key holder
can copy plaintext. A hostile/rooted device, malicious trusted publisher or
compromised APK is outside this confidentiality boundary. The catalog can withhold
or replay signed artifacts; signatures do not provide catalog freshness.

Trust remains the publisher public key embedded in the installed APK. Never
download a replacement trust anchor from the catalog. Signing authenticates the
publisher; encryption restricts readership. Possession of an unlock key alone
must never permit publishing executable code.

## Proposed v1 wire format

These are proposed implementation contracts, not current parser behavior.

### Catalog compatibility

Keep `schemaVersion: 1` and the existing `modules` array unchanged. Add an optional
root `encryptedModules` array, with the same grouping by opaque ID and version:

```json
{
  "schemaVersion": 1,
  "modules": [],
  "encryptedModules": [{
    "id": "sealed.a0123456789abcdef0123456789abcdef",
    "name": "Locked module",
    "latest": "1.0.0",
    "versions": [{
      "version": "1.0.0",
      "format": "construct-encrypted-v1",
      "artifact": "sealed/a0123456789abcdef0123456789abcdef/1.0.0.cenc",
      "sha256": "<SHA-256 of complete envelope>",
      "signature": "<base64 publisher signature over complete envelope>"
    }]
  }]
}
```

This is schematic JSON; placeholders are not valid hashes/signatures. IDs above
are synthetic, not deployment identifiers. The new host requires the neutral
label and disallows descriptive metadata in encrypted entries. Release tooling
also audits all public paths and surrounding publication content.

The inspected legacy `Packages.catalog` reads only `modules`, ignoring additional
root members. It therefore continues to show/install ordinary entries and does
not offer encrypted entries. Verify this against supported old APKs; do not claim
a friendly “upgrade required” message on clients that cannot recognize the field.
Do not insert encrypted artifacts into the legacy `modules` array or disguise
them as executable loader modules. New clients reject unsupported encrypted
formats per entry, without making ordinary entries unusable.

The combined arrays retain the 100-module limit, 50 versions per module and
512 KiB index limit. Reject duplicate IDs across arrays, duplicate versions,
unsafe paths and nonconforming field types. A malformed encrypted entry is not an
install candidate; it must not silently fall back to ordinary ZIP handling.
Existing HTTPS/no-redirect/no-credentials/no-query/no-fragment rules remain.

Update publisher and registry-verification tools alongside the native parser.
Current public-catalog verification only counts `modules`, requires ZIP paths and
does not validate this new array; a legacy verifier's success must not be reported
as coverage of encrypted entries. The new public verifier needs no unlock key:
check framing, identity, bounds, served-byte equality and publisher signatures.
The private build verifier additionally decrypts and applies all inner checks.
Both report ordinary and encrypted counts separately and reject an invalid
`latest` reference. Neither public verifier nor CI receives real content keys.

### Authenticated envelope

Use a small binary framing, not a ZIP wrapper or executable loader:

1. Eight ASCII magic bytes `CENC0001`.
2. Four-byte unsigned big-endian header length, from 1 through 4096.
3. Exactly that many UTF-8 bytes of a JSON header.
4. Exactly 12 nonce bytes.
5. AES-256-GCM ciphertext followed by its 16-byte authentication tag.

Header fields: `format` (exactly `construct-encrypted-v1`), `id` (opaque catalog
ID), `version`, `keyId` (random 128-bit identifier, lowercase hex), `zipBytes`
(inner ZIP length), and `manifestCommitment` (64 lowercase hex characters).
Reject duplicate JSON keys, unknown fields, invalid UTF-8, invalid lengths and
unsupported algorithms/versions. The single algorithm suite is fixed by v1;
there is no caller-selected cipher, KDF or executable compression plugin.

The plaintext is `manifestSalt || innerZip`, where `manifestSalt` is 32 fresh
cryptographically random bytes. The commitment is SHA-256 of the concatenation:
ASCII `ConstructManifestV1`, one zero byte, the salt, then the **exact uncompressed
bytes** of `manifest.json`. This salted manifest hash avoids publishing a useful
guess-checker for recognizable manifests. The salt stays inside the ciphertext.
Whitespace or field-order changes change the commitment; no JSON canonicalization
is needed. The inner ZIP manifest ID equals the opaque outer ID, and its version
equals the signed header/catalog version; its human name and all other real
metadata stay private. There is no second hidden identity that can collide with
an unrelated installed module.

GCM associated data is the exact prefix consisting of magic, header length and
header bytes. Generate a new cryptographically random 256-bit key per module key
generation and a fresh 96-bit nonce for **every encryption**, including retries.
The publisher records used nonces per key and rejects reuse. Version reuse with
different bytes is forbidden. Key IDs are random references, not hashes of keys.

The publisher signs **every byte of the complete envelope**, using the existing
`SHA256withRSA` publisher scheme. The catalog hash also covers those exact bytes.
Consequently the signature covers ciphertext, nonce, identity, version and the
salted inner-manifest hash. Do not sign reserialized JSON. Do not reuse the signing
key as a content key or derive one from the other. The catalog is not itself a
separately signed/freshness-guaranteed document.

### Limits

- Complete downloaded envelope: at most **4 MiB**, including framing/tag overhead.
- Decrypted inner ZIP: at most **4 MiB**, and small enough for that envelope cap.
  This deliberately reduces usable ZIP capacity slightly; it does not raise the
  existing download budget to accommodate crypto overhead.
- Per uncompressed ZIP entry: **2 MiB**; total expanded files: **12 MiB**;
  at most **128** entries, as today. Salt is separate from the ZIP file budget.
- Header: 4096 bytes; key-import text: 1024 bytes; at most 100 stored key records;
  one prepare/decrypt operation at a time. Reject excess rather than evict keys.

Check declared and observed lengths before allocation and during bounded reads;
ignore claimed ZIP sizes as authority. No nested encrypted envelopes or recursive
archive expansion. Keep existing extension/path restrictions. This proposal does
not introduce native binaries, WASM, service workers or unrestricted WebView URLs.

## Verification and installation state machine

`catalog entry -> bounded download -> publisher verification -> unlock -> bounded
ZIP validation -> native consent -> atomic install -> existing trial/keep/rollback`

1. Bound the download and verify its SHA-256 and publisher signature over the
   complete envelope **before requesting a key or decrypting**. A signature
   failure must not become a key prompt or a ZIP-parser error.
2. Parse the authenticated framing/header with strict bounds; check outer ID,
   version and format against the selected entry. The unsigned catalog cannot
   redirect a signed payload into a different module's identity.
3. Select the exact `(publisher fingerprint, opaque ID, keyId)` key record. Never
   try every stored key. Native Settings owns import; module JS cannot enumerate,
   import, read or export keys. Recheck operation generation and key availability
   after asynchronous work.
4. Decrypt into bounded private memory. Do not parse, display, log or write any
   bytes returned by incremental cipher updates until GCM finalization succeeds.
   Check exact plaintext length `32 + zipBytes` and reject trailing/truncated data.
5. Apply the **same** ZIP path, duplicate-entry, file/directory collision,
   extension, file-count, decompression, manifest, identity, runtime/API and entry
   checks as ordinary packages. Compare the salted commitment before parsing
   `manifest.json` as JSON. Only fully validated metadata reaches native UI.
6. Display the real module name/version and requested capabilities in the normal
   native install/update consent. A valid key is not install consent or a grant.
   Preserve revoked access and existing update/trial/data behavior.
7. Commit using the existing staging/atomic-store discipline. Preserve the signed
   envelope and its identity/key binding with the install record for revalidation,
   re-unlock and rollback. No executable state transition before consent succeeds.

Every open/recovery/rollback path must check the persisted envelope/key binding as
well as installed-file integrity. Do not trust an unsigned local manifest to
reclassify an encrypted install as an ordinary one. Restore signed-envelope
provenance before rebuilding a missing/corrupt installed-file index; fail closed
on missing or inconsistent records.

Refactor shared validation into an internal authenticated-package path; do not
expose a public “skip signature” flag. The ordinary path still verifies its signed
ZIP; the encrypted path authenticates the envelope and GCM before reaching that
same validator. An inner detached signature is unnecessary because the signed
envelope authenticates the complete encrypted ZIP. Tests must prove that holding
a content key cannot substitute for the publisher signature.

CSP, origin-scoped bridge, network rules, permission checks and resource handling
remain exactly those of an ordinary validated module. There is no decrypted
`eval`, `blob:` loader, remote HTML or special privileged run mode.

Cancellation, leaving preparation, backgrounding before consent, key removal,
process death and timeout discard the pending candidate; none may install later
via a stale callback. Existing download timeouts remain. Local decrypt/validation
has a 15-second foreground-operation deadline, checked between bounded stages;
late results are discarded even if a platform crypto call cannot be interrupted.
Run off the UI thread. Performance must be measured, not assumed from emulator
results; any budget revision requires a documented reason.

## Native key UX and storage

Settings gains **Module keys**: add, list opaque references/local labels, forget.
Support manual entry of a 64-hex-character key; allow whitespace grouping but no
passwords or key derivation in v1. Import also specifies the opaque module ID and
key ID. A versioned QR record carries those same fields plus publisher fingerprint;
it is data, never a URL or intent. Validate all fields and show the binding before
saving. A key record's publisher must match the APK's trusted publisher.

The publisher transfers the key/QR privately inside the LAN or directly to the
user; public catalogs, public artifacts, URLs and diagnostics never carry it.
No cloud key service, account system, public QR image or clipboard auto-read.
Pasting is allowed only as an explicit user action; the host does not copy keys
out. Entry uses a secure native screen, with autofill/suggestions disabled and
screen capture blocked. Clear input after completion/cancellation; never echo a
full key in confirmation or error text.

If QR scanning is implemented, it is an explicit, foreground native Settings
action, with Android camera consent, on-device decoding, no gallery upload,
retained frame or network decoding service. It grants no module camera access.
Manual import is the required baseline; QR may be a separate bounded slice and
must not be advertised as available until tested.

Persist content keys wrapped by an app-owned Android Keystore AES-GCM wrapping
key, in app-private no-backup storage. Use fresh wrapping nonces and bind publisher,
module and key IDs as associated data. Never put raw keys in SharedPreferences,
module storage, bridge responses or logs. Do not claim the imported content key
is hardware-backed/non-exportable: it exists temporarily in host memory. Clear
buffers best-effort; managed-runtime zeroization is not a guarantee.

Keep the current no-backup/device-transfer exclusions, test actual extraction
rules, and add no export endpoint. Keystore loss means locked packages and private
re-import, not automatic remote recovery. Debug/pilot installations have independent
key stores and app data; they do not share or migrate secrets implicitly.

## Plaintext, forgetting keys, updates and rollback

V1 protects distribution, **not all installed data at rest**. After successful
unlock/consent, validated files may use Construct's existing app-private extracted
store and integrity checks. The trusted host can read them; module-generated
saved data retains its existing storage semantics. Never call this memory-only
execution or device-forensic protection.

**Forget key** must do more than delete a Settings row:

1. Durably mark that key binding unavailable, invalidate outstanding prepares,
   and stop affected live sessions/bridge deliveries before reporting success.
2. Remove the wrapped key; make all versions depending on it non-runnable.
3. Remove their extracted code/assets and pending plaintext staging, including
   active, trial and previous versions. Retain signed ciphertext and a locked
   inventory record; hide decrypted metadata on locked cards.
4. Keep module user data and grants for a later authorized re-import; explain
   that forgetting a key does **not** erase saved data. Full removal remains a
   separate existing user action with its own data semantics.

Cleanup is journaled/idempotent and retried before inventory/open after a crash.
If deletion fails, remain locked and report pending cleanup; never claim the
plaintext was removed. No rollback or cached-open path may bypass the missing-key
gate. Re-import validates the envelope again, restores code only for previously
consented versions, and never re-enables revoked grants or auto-launches a module.

Revocation means the host forgets the key; **it can't un-copy anything already
unlocked**. File deletion is not secure erasure, and saved data may itself contain
module-derived information. There is no remote revocation/expiry promise.

Updates normally reuse the opaque module ID, with fresh nonce and immutable new
version. Key rotation uses a new random key/key ID; importing it does not delete
old keys. A missing new key leaves the current working version intact. Rollback
requires the particular previous version's key; never silently roll back to an
unavailable version. Keep explicit older-version consent and normal data-format
compatibility rules. If all keys for an ID are forgotten, it remains locked.
Removing one generation must not disable another generation whose key remains.

Encrypted-to-plaintext conversion under the same ID is rejected in v1, so a
catalog entry cannot silently abandon the confidentiality expectation. Existing
ordinary packages are not migrated in place. A future migration needs a separate
explicit contract, not format guessing.

## Errors and diagnostics

Use bounded native error categories; never include key input, decrypted metadata,
payload bytes, absolute private paths or raw crypto exception text.

| Condition | Proposed native result |
| --- | --- |
| No matching stored key | `PACKAGE_LOCKED`: add the matching key in Settings |
| Validly framed key with failed GCM authentication | `PACKAGE_WRONG_KEY`: this key cannot unlock this package |
| Malformed import | `KEY_FORMAT`: check the key format; no echoed input |
| Failed publisher signature/hash | Existing signature/checksum failure; no key prompt |
| Unsupported encrypted format | `PACKAGE_FORMAT_UNSUPPORTED`: host update needed |
| Invalid authenticated ZIP/manifest/commitment | `PACKAGE_INVALID`: package validation failed |
| Keystore unavailable | `KEY_UNAVAILABLE`: unlock device or re-import as appropriate |
| Cancelled/stale operation | No install; bounded cancelled/stale result |

GCM failure cannot mathematically distinguish a wrong key from incorrectly
encrypted bytes signed by a publisher. “Wrong key” is the normal recovery UX,
not proof of the cause; never report an unauthenticated JSON/ZIP parse error.

Public/staging receipts use synthetic IDs, error codes, artifact hashes, counts
and timings. Copy diagnostics must not include keys, QR contents, plaintext
application text, decrypted names or payloads. Review the existing host and
module-log paths: encrypted modules' free-form logs are excluded from exported
diagnostics by default. Module code never receives the content key, but can log
its own private data, so native crypto-log redaction alone is insufficient.

## Acceptance contract

All implementation evidence uses redistributable synthetic payloads. The design
note is not evidence that any of these checks have passed.

1. **Crypto interoperability:** publisher-tool and Android known-answer vectors;
   valid unlock; wrong key; changed nonce/header/tag/ciphertext; unsigned and
   attacker-reencrypted payload with correct content key; wrong publisher;
   repeated nonce rejection; swapped module/version/key binding; manifest
   commitment mismatch. Verify signature-before-decrypt and GCM-before-parse with
   instrumentation, not just an eventual failure message.
2. **Parser boundaries:** truncation/trailing bytes, duplicate/unknown header
   fields, invalid UTF-8 and integer lengths, every exact size boundary and +1,
   decompression bombs, path traversal, duplicate/colliding files, unsupported
   extension/runtime/API, absent entry/manifest and nested envelopes. All fail
   before installation or WebView creation, without unbounded allocation.
3. **Compatibility:** mixed catalog on current and supported old APKs; ordinary
   entries still browse/install; encrypted subset hidden on legacy APKs; new
   host handles unsupported formats without breaking ordinary entries. Existing
   ordinary package verification and tests remain unchanged in outcome.
4. **Consent/sandbox:** key import alone installs nothing; real name and grants
   appear only after verification/unlock; denials/revocations persist; CSP,
   network/origin checks, screenshots policy and bridge limits remain enforced.
5. **Lifecycle/storage:** cancel/background/process death/full disk at every
   prepare/commit/forget transition; late crypto result after forgetting; cleanup
   failure and restart; no residual runnable plaintext or stale bridge access;
   missing Keystore key and backup/device-transfer exclusion. Inspect private
   staging and diagnostics using synthetic distinctive markers.
6. **Independent delivery:** two encrypted versions change synthetic module
   behavior on the same exact APK. Test keep/rollback with preserved user data,
   removed grants, key rotation, missing old/new keys and re-import after forget.
   Also run the ordinary module update/rollback regression controls.
7. **Privacy/publication:** scan index, paths, artifacts, build outputs and
   exported diagnostics for synthetic private markers/key/QR values. Real
   payloads stay outside public fixtures and receipts. Verify served artifact
   hashes/signatures after promotion; catalog publication occurs last.
8. **Physical phone:** exact APK/envelope hashes; native manual import and optional
   QR; TalkBack/font scaling/keyboard/orientation; offline reopen after process
   death; wrong-key recovery; forget/re-import; actual unlock latency/memory.
   Emulator evidence cannot replace this check or establish device key security.

## Implementation and review sequence

1. Review this generic note: cryptographic framing, privacy, ownership, lifecycle
   and legacy catalog behavior. Resolve findings before implementation.
2. Implement publisher format/vectors and host verified-prepare/shared validation,
   then native key management and forget/recovery behavior. Keep unrelated runtime
   capabilities independently reviewable; this feature is not their prerequisite.
3. Run publisher/package tests, JVM tests, lint, architecture checks and exact-APK
   synthetic Android acceptance. Write a staging report with failed controls as
   well as passes, retaining raw private receipts outside the repository.
4. Obtain the focused physical-phone check and independent acceptance verdict.
   Promote only the reviewed exact artifacts; no runtime/hosting change is made
   by merging this documentation alone.

The drafting author owns concept/design review follow-through but is not a
substitute for independent implementation review. A draft PR is not an acceptance
verdict. Until the host feature passes, an ordinary signed catalog on a private,
phone-trusted HTTPS endpoint remains the fallback; private LAN test builds remain
valid. No production catalog edit or key issuance is part of this proposal.

## Source anchors and remaining release decisions

Baseline inspected: `49c4796` (2026-10-17). Relevant code:
[Packages.kt](../core/app/src/main/java/dev/construct/runtime/Packages.kt),
[ModuleStore.kt](../core/app/src/main/java/dev/construct/runtime/ModuleStore.kt),
[ModuleWebView.kt](../core/app/src/main/java/dev/construct/runtime/ModuleWebView.kt),
[backup rules](../core/app/src/main/res/xml/data_extraction_rules.xml).

Before implementation lands, record the actual minimum host release/build for
`construct-encrypted-v1`, the supported legacy APK compatibility matrix, and
whether QR is included or explicitly deferred. Those release choices do not
relax manual key import, bounds, signature, consent, cleanup or hardware gates.
