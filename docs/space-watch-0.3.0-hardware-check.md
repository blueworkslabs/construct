# Space Watch 0.3.0 phone checklist

Status: **superseded; do not use for hardware acceptance**. See [0.3.1](space-watch-0.3.1-hardware-check.md).
Use an installed alpha37-or-later host (API 0.14). Older hosts cannot run 0.3.0.
This task does not publish the alpha37 APK or change the production catalog.

[Immutable test catalog](https://raw.githubusercontent.com/blueworkslabs/construct/47f038b6d9d0ced166f1b5e03d6a504f9e5fcc6d/catalog/candidates/space-watch-030/index.json).
Install **Space Watch 0.3.0**, not Synthetic Space Watch. Do not remove your
installed module first: normal signed updates preserve supported preferences/cache.
The compass-and-tilt grant is optional and starts off until explicitly enabled.

1. Before granting compass access, tap Follow: a note should explain Module
   access, with the static sky still usable.
2. Enable “Allow reading compass and tilt” in Construct’s Module access. Tap
   Follow; hold the phone flat with its top pointing where you face. Calibrate
   with a figure eight when asked. Stay away from magnetic cases/nearby metal.
3. Turn slowly through known directions. The dome should rotate and the wedge
   stay at the top. Headings use true north where WMM2025 correction is available;
   the displayed uncertainty is the sensor estimate, not a guaranteed error bound.
4. Pick a visible star, planet or satellite and check the relative turn guidance.
   Confirm the physical target independently; predicted visibility is not proof
   of an observable object in current weather/light.
5. Hold upright: flat-phone guidance replaces directional instructions. Return
   flat to resume. Tap Follow off: north-up returns.
6. Open Quick Settings during Follow. After closing it, Follow should remain off
   with an explanation. A tap restarts it. The native Construct menu instead
   pauses and explicitly returning resumes the requested Follow mode.
7. Revoke compass access, reopen, and check Follow is denied. A fresh module
   run always starts with Follow off. App switching may end the module under
   the existing host lifecycle.
8. Check landscape, large text, red mode and, if used, TalkBack. Browse the
   compass and turn text; rapidly changing headings must not constantly interrupt
   spoken navigation. Try an ordinary 0.2.14 → 0.3.0 update with saved preferences.

[Exact-artifact staging status](space-watch-0.3.0-staging.md).
