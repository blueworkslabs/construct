# Native gallery export — alpha 12

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

The camera launcher 0.1.1 updates explanatory copy only; it remains usable on
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

Implementation is under acceptance. Targeted JVM checks cover exact copying,
stream closure before publication, failed/partial writes, denied final
authorization, cleanup failures and cross-module/deleted-file rejection. The
camera runner adds cancel, actual MediaStore publication, exact JPEG comparison,
and independent-copy lifetime checks to the existing camera scope.

Final APK/build, Android receipts and Pixel status will be recorded after the
corresponding checks finish. The pre-existing direct-Reopen accessibility issue
remains separate and is not claimed fixed here. Face analysis and LAN discovery
remain later milestones.
