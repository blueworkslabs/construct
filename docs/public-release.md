# Public source release: provenance and verification

Construct's first public repository is a **clean initial source import**, under
MIT, from the alpha11 private pilot. It intentionally does not publish private
workbench history, deployment endpoints/certificates, raw device receipts,
signing keys, personal references or previous APKs. Credits and the engineering
case study preserve the useful provenance without exposing private operations.

## Changes for reproduction

- No built-in lab registry or CA. Default APK uses system TLS trust; operator
  shortcut/CA resources are generated into an ignored build overlay.
- Complete signed synthetic fixture bootstrap, with a separately generated local
  publisher identity. Historical fixture labels are current-source test fixtures,
  not claims to reconstruct old private artifacts byte-for-byte.
- Explicit hostname/root/catalog configuration for the disposable runner. Missing
  or mismatched configuration refuses device access, including hierarchy reads.
- Public HTTPS origin template, contribution/security documentation and source CI.
- The intentionally blocked probe address uses documentation-only address space;
  that fixture has its own new immutable version.

## Verification ledger

The public source was built in a fresh source directory with newly generated
fixtures and a separate module signing directory. The local SDK/JDK and dependency
caches were reused: this is **not** a claim that an empty machine was provisioned
without operator work.

- 86 JVM/Robolectric tests passed; lint: zero errors, 17 warnings.
- Safe-default debug APK built successfully. Its compiled network-security resource
  contains system trust only, and no operator CA is packaged.
- 18 publisher/configuration/registry, 38 runner, one server and 42 module tests passed.
- Separately generated example catalogs passed served HTTPS, hash, signature and
  path/method checks against their matching publisher public key.
- A complete clean operator-profile run passed Checklist (5), probes (5 BLOCKED /
  6 CONTAINED / 0 FAIL), renderer recovery, tone (7), consent (5), Focus (6), Snake
  (8) and Contacts (9). The emulator stopped.
- A separate same-APK camera run passed nine scoped checks, including a decoded,
  nonblank synthetic JPEG without GPS metadata. It restored non-root ADB and stopped.
  The direct-Reopen accessibility path remains excluded via explicit fresh launches.
- The first camera setup attempt failed before any camera checkpoint on a transient
  accessibility field loss. A bounded accessibility text-replacement fix and four
  regression tests preceded the accepted rerun; that failure is not erased or
  represented as a pass. No APK change was needed.

See the [sanitized machine-readable summary](evidence/public-source-2026-09-13.json).
Raw receipts remain private. The [hosted workflow status and logs](https://github.com/blueworkslabs/construct/actions/workflows/verify.yml)
are separate evidence: CI builds fresh signed fixtures and runs local/JVM/lint/APK
checks, not the external emulator suite.

The reference screenshots and historical alpha11 acceptance described in
[evidence.md](evidence.md) belong to the earlier private pilot, not a different
build silently relabelled as this release. The known direct-Reopen accessibility
limitation remains. No public release APK or shared signing identity is shipped.

## Source audit

The clean import starts with no private parents. A tracked-source pattern audit and
a Git secret-detector scan found only the intentional credential-shaped URL in a
rejection test; it is synthetic, not an operational credential. Credential validity
probing was disabled. These are useful checks, not a guarantee that a scanner
can recognize every secret or establish runtime security. Selected screenshots
were visually reviewed, and generated deployment/signing/build files are excluded.

## Reproduction boundaries

Linux/KVM, Android SDK licenses/images, app-free snapshots, HTTPS and access policy
remain operator-provisioned. CI runs source/JVM/lint/default-APK checks, not the
entire external-staging camera/contacts suite. Agent-provider accounts and Discord
are optional workshop tools, not dependencies of the Android runtime.
