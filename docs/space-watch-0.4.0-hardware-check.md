# Space Watch 0.4.0 phone checklist

Status: **awaiting exact-package Android acceptance; do not treat as clearance.**
Use an installed alpha37-or-later host (API 0.14). **No new APK is needed if
alpha37 is already installed.** This review does not release an APK or promote
the production catalog.

[Immutable test catalog](https://raw.githubusercontent.com/blueworkslabs/construct/f4b0ff1eaf3e745d0130be0b733c91e685398f7b/catalog/candidates/space-watch-040/index.json).
Install **Space Watch 0.4.0**, not Synthetic Space Watch, as a normal signed
update without uninstalling. Real package SHA-256: `f4799b20c88d22d76f7be7dab2791c929eda8c80140386e6d31dc74f639ea98f`.

1. Confirm saved preferences/cache survive the update and Follow starts off.
   Without compass consent, Follow explains Module access and the static sky works.
2. Enable “Allow reading compass and tilt”, tap Follow and calibrate with a
   figure eight when prompted. Confirm the flat-phone dome still turns correctly.
3. Raise the phone like a camera: the drawn viewfinder follows the **back/camera
   axis**, without requesting camera access. Select a visible satellite or train
   from the list. Check the rim arrow and screen-relative up/down/left/right words.
4. Aim above 45°, near the zenith, with the phone rolled and in landscape.
   The viewfinder must not drop out merely because the host calls this pose flat.
   Lower the camera toward the ground to return to the dome; check switch hysteresis.
5. Near the target, check the 4° lock and the object's track. Confirm actual sky
   alignment independently: lock is based on estimated heading, not proof that
   the target is physically within 4°. Compass uncertainty remains displayed.
   With nothing selected, aim toward a bright planet/star to check its name.
6. Enter rewind/pass preview, then raise the phone: pointing returns to Now.
   Turn quickly or roll the phone substantially and check prompt reacquisition.
7. Check calibration hint recovery, red mode, large text and TalkBack if used.
   Spoken directions should change when needed without reading every distance.
8. Open Quick Settings: Follow ends and stays off until explicitly tapped.
   The native menu pauses it; explicit menu return can resume the requested mode.
   Follow off, grant revocation and a fresh module run must leave no stale aim.
   App switching can close the module under the existing host lifecycle.

[Exact-artifact staging report](space-watch-0.4.0-staging.md).
