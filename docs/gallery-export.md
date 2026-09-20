# Native gallery export — alpha 12

Historical native-workspace behavior through alpha30. The alpha31 candidate
reuses the bounded native engine/storage but retires that workspace: modern
Camera owns the saved-photo UI and receives pixels/results under fresh grants.
See [the new API and consent boundary](module-photos.md). Statements below about
no JavaScript image/result/export access describe the old workspace only.

This is a host change developed in the public repository. Private deployment
configuration and signing identities remain operator-owned; the historical private
workbench is not a second development upstream.

## User flow and limits

In Pocket Camera, take a photo or open Saved photos. Select a photo, tap
**Save to phone gallery**, then **Save copy**. **Keep private** cancels with no
export. The confirmation explains that each save makes an independent copy,
visible to photo apps and potentially their configured backup services. Construct
does not initiate an upload. The native screen confirms the destination only
after Android publishes it in **Pictures/Construct**.

Private-photo deletion and app uninstall do not delete gallery copies. The
private album's existing limits are unchanged. Repeated confirmed exports create
separate copies. Android 10+ uses MediaStore without requesting storage/media-read
permissions. Android 9 still supports the existing private album but does not
offer gallery export in this slice.

The camera launcher 0.1.2 updates explanatory copy only; it remains usable on
older hosts and explicitly describes gallery export as a supported-host feature.
It still exposes just `camera.capture({op: 'open'})`. No new bridge operation,
module-visible image bytes, paths or export authority were introduced.

## Transaction and lifecycle

- Select only an existing validated photo in this module's private directory.
- Keep disk/provider work on the camera's bounded worker.
- Insert a random-named JPEG with `IS_PENDING=1`; copy exact bounded bytes and
  close the output before publication. No photo name or URI enters diagnostics.
- Under the session/module grant guards, recheck that the workspace is live and
  both access gates still permit the operation before clearing `IS_PENDING`.
- Delete a pending item on write/authorization/publication failure. If the
  provider also refuses cleanup, report that separately rather than claiming
  successful cancellation. Android's pending-item expiry handles abandoned rows
  after process death; abrupt process-death recovery is not immediate cleanup.
- A completed publication is not undone by subsequent revocation, leaving the
  workspace or deleting the private photo. Export is a deliberate external copy.

## Verification status

Native source `13a2984`: 92 JVM tests passed (no failures/skips), including exact
copying, stream closure before publication, failed/partial writes, denied final
authorization, cleanup failures and cross-module/deleted-file rejection. Lint has
zero errors and 17 existing warnings. Publisher/configuration (18), optimized
Python runner (38), and camera module (3) checks passed.

The optimized operator-profile APK has SHA-256
`3c5aede4a10b6f33d90b5d3d17127886a0acb966610bc98231456771f7b03cc1`.
It preserves the original pilot APK signer, publisher key, bundled demos and
Android permissions. No new storage/media-read permission is present. This is
not a universal preconfigured public installer.

Android 16 run `20260913T195556Z-6b8ff141` passed **12 camera/gallery checkpoints**
on that exact APK and launcher 0.1.2. The actual published MediaStore JPEG was
24,010 bytes, 1024×768, not pending, and byte-identical to the private original;
its EXIF orientation was retained and no GPS metadata was found. Cancel created
no visible copy, and private deletion left the exported file unchanged. The
emulator stopped and ADB returned to non-root. These are synthetic-photo tests,
not physical-camera or vendor-gallery UI acceptance.

Two earlier runs remain failed: a package-download timeout before installation,
then an unrelated Digital Wellbeing ANR obscuring the workshop. Acceptance used
the explicit `--disable-digital-wellbeing` option on the disposable image;
that environment override is recorded, not an app fix. An earlier launcher 0.1.1
was test-only and superseded to clarify consent wording, without overwriting it.

Host baseline `20260913T201650Z-97ed4007` passed on the same APK: five Checklist
checkpoints, probes **5 BLOCKED / 6 CONTAINED / 0 FAIL**, renderer-loss recovery,
seven tone lifecycle checks and five consent checks. The in-app APK hash matched,
and the emulator stopped. The reusable-code commit `c75e2b9` also passed hosted
CI. The operator subsequently reported the Pixel gallery check worked as
expected and explicitly authorized merging. This is a reported hardware pass.
The
pre-existing direct-Reopen accessibility issue is excluded through the documented
fresh-launch camera scope, not claimed fixed. Face analysis and LAN discovery
remain later milestones.

Baseline development receipts also retain an accessibility-tree failure after
Checklist update (the screenshot rendered the controls). Reordering the existing
bounded viewport refresh before the update-control assertion passed all five
Checklist checks without restarting the module. That run then stopped before
any probe verdict because the lab catalog lacked the public runner's exact
probe 0.1.4. Publishing that immutable signed fixture corrected the setup; neither
failure is treated as a complete host-baseline pass.

Further retries retained a dropped-character setup failure and another missing
dynamic accessibility row. Input now uses bounded idempotent accessibility text
replacement, requiring the exact value before Add. The final accepted baseline
did not need an experimental observer reconnect; that unused workaround was
removed rather than presented as a fix. Passing one scoped run does not establish
that the intermittent accessibility issue is resolved. No native source or APK
changed during these runner corrections.

## Review / phone checkpoint

Review publication authorization, pending-item cleanup and independent-copy
consent in [PR #1](https://github.com/blueworkslabs/construct/pull/1). The branch is
merged after that explicit operator approval. No independent-review result is
invented from the merge authorization.
Install the operator-provided alpha 12 pilot over the existing host, refresh its
configured registry and update Pocket Camera to 0.1.2. Export one non-sensitive
test photo, check the phone photo app's on-device **Pictures/Construct** folder
and orientation, then verify deleting the private original leaves the exported
copy. Behavior-only feedback is sufficient; no personal photo needs sharing.
