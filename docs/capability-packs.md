# Optional capability packs: proposed direction

Status: design only. Alpha 16 still includes its native engines and works offline
immediately. No downloader, native plugin loader, or trust expansion is implemented.

## Three layers

1. **Core host:** installation, signatures, lifecycle, grants, native UI and bounded
   device APIs. New Android permissions/components still require an APK update.
2. **Optional capability support:** reusable engines and model/data assets owned
   by the host. Multiple modules can share one installed version.
3. **Web modules:** signed HTML/JS/assets requesting versioned capabilities. A module
   signature alone must never authorize loading its native code into the host.

Moving bytes from the APK to a download only saves storage for users who do not
need that support. Removing redundant architectures and unused code saves actual
bytes even for users who install every feature; do that first.

## First implementable slice: data packs

Bundle the engine in the APK; download model/data assets only when a human chooses
the capability. A host-controlled signed catalog pins pack version, content hash,
size, engine/API compatibility and dependencies. Store verified assets privately;
never expose arbitrary paths/URIs or a generic engine invocation to module code.

Installation should show download/storage size and requested capability access
separately. Download to a bounded temporary file, verify before atomic activation,
keep a previous compatible version for rollback, and never replace in-use files.
Cancellation, full disk, interrupted download, invalid signature, incompatible
engine and restart must leave existing modules usable. No silent cellular download.

Installed support works offline. Offer storage management and remove unused packs
only when no installed module depends on them, with explicit user confirmation.
Revoking a grant blocks use even if a pack remains installed. Pack removal is not
permission revocation, and granting access is not permission to download anything.

Our current models total only about 5 MB: data packs prove the lifecycle but do
not alone solve native-library growth.

## Native engines need a separate decision

Do not put `.so`/DEX files in ordinary module ZIPs and load them into the host.
That code executes with native privileges, bypassing the web-module trust model.
Signed provenance is necessary but does not provide isolation.

For a future engine delivery experiment compare:

- **Platform-installed feature splits:** Android-managed code installation;
  distribution mechanism and availability outside Play must be established.
- **Companion capability APK/service:** explicit Android install/update, narrow IPC,
  signature checks, limited granted photo access and process isolation. More user
  friction, but a clear separate installation boundary.
- **Sandboxed portable code (e.g. WASM):** potentially module-deliverable computation,
  with a deliberately bounded input API and measured performance/memory behavior.
  It is not a drop-in replacement for the current native image workspace.

No option is selected without a runnable proof of offline operation, updates,
rollback, grants and failure containment. Retain the current native photo boundary;
do not send personal images into web modules just to make packaging easier.

## UX follow-up after the smaller pilot

The user reports real-world Pocket Measure usefulness across multiple scenes.
Once the optimized build has a Pixel confirmation, use the
[UX review brief](pocket-measure-ux-brief.md) for a review with Fable:
photo framing/zoom, precise endpoint placement and correction, marker-size entry,
clear result/uncertainty wording, and small-screen/large-font accessibility.
These are review topics, not promised implemented features. Reviewer mentions
remain with the human; no automated bot handoff is part of this change.
