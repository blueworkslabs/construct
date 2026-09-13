# From a request to a tested Android module

This is a reproducible-workflow case study in preparation, based on a working
private alpha. It is not a novelty claim or a claim that an agent can ship arbitrary
Android features without engineering or human review.

## The division of work

A human supplies the goal, steers trade-offs, controls reviewer mentions and does
focused phone acceptance. OpenClaw provides the agent workspace and tool access.
An implementation agent writes the host/module code and runs the toolchain;
reviewer agents inspect runtime boundaries, evidence and UX. The roles can also be
performed by humans. A hosted LLM connection is not needed by an installed module.

## The loop we actually used

1. **Define a small acceptance contract.** Specify capability requests, persistence,
   interruption behavior and what the emulator can—and cannot—prove.
2. **Implement the smallest useful slice.** Keep game/timer rules separate from the
   UI for deterministic tests. Adding contacts or camera requires a new native API
   and APK; adding Snake using existing storage does not.
3. **Run local checks.** Module JS tests, package/registry tests, JVM/Robolectric
   tests and Android lint catch different classes of error.
4. **Build and identify candidates.** Build the optimized pilot APK; check its
   signer and SHA-256. Build/sign versioned module ZIPs in a candidate catalog.
   Once candidate bytes change, use a new module version rather than overwrite one.
5. **Run disposable Android acceptance.** Transfer the exact APK to a dedicated
   runner. Verify its supplied hash, restore a named app-free snapshot, verify the
   restore, install the APK, then drive real native and WebView controls.
6. **Collect evidence, including failures.** Each child suite writes a structured
   result, screenshots and scoped diagnostics. Parent cleanup stops the emulator
   even after an exception. Review the screenshots as well as machine verdicts.
7. **Promote the exact accepted bytes.** Keep versioned artifacts immutable and
   publish the catalog last. Verify HTTPS downloads, package hashes/signatures and
   the APK download. Testing one build and distributing another breaks the chain.
8. **Ask for a focused phone check.** Real audibility, camera behavior and control
   feel need hardware observations. Record what was reported without inventing a
   device version, a separate observation or a broader pass.

## The test bench

The reference setup separates builds/signing from an on-demand Linux runner with
KVM acceleration. The runner VM has 6 GiB RAM and 2 vCPU; Android uses 2 GiB RAM,
while the emulator process needs a larger allowance (5 GiB in this setup). These
are measured reference settings, not universal minimum requirements.

There are separate app-free snapshots for the ordinary Android image and the
synthetic-camera image. Changing the camera backend invalidated assumptions about
the snapshot, so the runner verifies which snapshot actually loaded. Android SDK
licenses and virtualization support must be provisioned by the operator.

ADB is local to the runner and targets the disposable emulator explicitly. The
controller connects over SSH; emulator/ADB control is not exposed as a public
network service. Signing keys stay on the build side. Personal phone data is never
used to seed emulator tests.

## Lessons from failures

- A WebView and a game script declared the same global name. Isolated JS tests
  missed it; the signed Android candidate failed. A combined-script check followed.
- Android's contacts provider rewrote a compound sort order. Reversed insertion
  and duplicate-name fixtures exposed incorrect paging that a tidy fixture hid.
- A Canvas board looked technically present but was much too small. Screenshot
  review and minimum rendered-size checks rejected the layout.
- Accessibility trees and animation timing made a reported tap insufficient proof
  of an action. The driver now waits for stable, exact controls and observable
  outcomes; it does not retry arbitrary actions blindly.
- A longer workshop list exceeded the driver's fixed scroll assumption. That
  parent stayed failed even though earlier child scopes had passed. A fresh,
  explicitly scoped continuation finished the remaining checks on the same APK.
- One short camera-reopening pass did not generalize. The intermittent direct-Reopen
  accessibility problem remains documented; the scoped camera regression uses an
  explicit fresh-launch workaround and excludes that path.

## Keep claims attached to evidence

Use different words for different observations: **BLOCKED** requires explicit
native blocking evidence; **CONTAINED** can mean the host stopped a module on a JS
error without proving that no packet left the device. A missing event or timeout
is not a successful block. Renderer recovery is a separate check.

A complete set of child scopes on the same APK can be useful evidence even when
one parent failed because of the driver. Describe it as combined scoped evidence,
not as one uninterrupted successful suite. Keep original failed receipts privately
and publish only reviewed, sanitized examples.

## Adapting it

The pipeline is not tied to a particular model, chat product or private network.
Keep the useful seams: an explicit module contract, a controlled signer, a
reproducible candidate build, a disposable test target, evidence with precise scope,
and human control of deployment and device feedback. Follow the [explicit setup and verification boundaries](public-release.md): configure
your own runner and registry rather than inheriting the reference lab settings.
