# Runtime architecture

Construct has two distinct trust domains: the development/deployment machinery
and the Android host that actually runs installed modules.

```mermaid
flowchart TB
    subgraph Development[Development and delivery]
        Workshop[Human + implementation/review agents] --> Build[Build and local tests]
        Build --> Signer[Operator-controlled signing]
        Signer --> Candidate[Immutable candidate registry]
        Candidate --> Runner[Disposable Android emulator]
        Runner --> Evidence[Receipts + screenshots]
        Evidence --> Registry[Promoted HTTPS registry]
    end
    subgraph Phone[Android device]
        Registry --> Installer[Native installer + signature/compatibility checks]
        Installer --> Store[Installed code + previous working version]
        Store --> WebView[Per-module WebView]
        WebView --> Bridge[Origin-scoped versioned bridge]
        Bridge --> Grants[Manifest declarations + per-module grants]
        Grants --> Local[Bounded local storage / short tones]
        Grants --> AndroidGate[Android permission gate]
        AndroidGate --> Contacts[Bounded read-only contacts]
        AndroidGate --> Camera[Native camera UI + private album]
    end
```

## Host responsibilities

- `Packages.kt`: validate manifests, compatibility, ZIP structure, hashes and the
  pinned publisher signature before code becomes runnable.
- `ModuleStore.kt`: keep installed/trial/previous-working state, grants, module data
  and bounded diagnostics. Rollback changes code; data compatibility remains a
  responsibility of the module author.
- `ModuleActivity.kt` / `ModuleSessionView.kt`: native module-first shell, menu,
  retained WebView rotation, paused in-session diagnostics and real-background
  teardown. Access changes stop the module before the native access screen.
- `ModuleWebView.kt`: local module resources, restrictive WebView configuration,
  origin-scoped bridge and native request/lifecycle enforcement.
- Native contacts/camera components: fixed operations and bounds instead of
  caller-selected provider URIs, raw SQL, arbitrary paths or camera frame streams.

## Module contract

A module ZIP contains `manifest.json` and its declared entry point plus HTML/CSS/JS
and assets. Module tests stay in the repository; they are not shipped into the ZIP.
The manifest identifies the module/version, runtime, API target and requested
capabilities. API0.6 adds a validated theme colour and host-owned corner-layout CSS.
See the [module API](module-api.md) and [manifest schema](../schemas/module-manifest.schema.json).

The native menu is not HTML controlled by the module. A cooperative visibility
event lets games pause/save; native capability gating does not rely on that
cooperation. Storage can finish a submitted save while menu-paused. Non-storage
host calls are gated, effects stop, and stale personal-data replies are invalidated.
This is not a claim that every possible JavaScript timer or WebView audio path stops.

## Lifecycle boundaries

Web modules retain their live session through orientation changes. Snake explicitly
pauses rather than catching up after rotation. Leaving the app ends the session;
reopening uses each module's saved state. Process death is not silently treated as
an in-memory resume. The native camera workspace has a separate policy: rotation
or backgrounding closes/releases it; previously saved photos remain.

## Deployment boundaries

There are two independent signing identities: the Android APK identity and the
module-publisher identity pinned by the APK. A valid signature establishes publisher
provenance, not harmlessness. HTTPS validates registry transport; it does not replace
package signatures. Generated keys and private test/deployment material do not
belong in the public source distribution.
