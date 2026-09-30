# Space Watch 0.5.1 phone checklist

Status: **ready for physical-phone checks: 31/31 functional Android gates pass.**
The emulator aborted during requested shutdown after the checks; it is stopped
with no process remaining. See the report for the exact teardown caveat.
Use an installed alpha37-or-later API 0.14 host. No new APK if alpha37 is installed.

[Immutable candidate catalog](https://raw.githubusercontent.com/blueworkslabs/construct/03a2490ba541edc7620b8b7a46d35858ee5dfd8e/catalog/candidates/space-watch-051/index.json).
Install **Space Watch**, not Synthetic, as an ordinary update without uninstalling.

1. Update from 0.4.1. The new mirror origin requires fresh Internet consent.
   Declining disables all downloads, not just the mirror. Saved data remains
   usable; approving Internet again permits automatic loading.
2. Open Layers. Navigation and Geostationary start off; enable both. Check the
   wrapped toolbar, switches and Close/Done controls in portrait/landscape and
   enlarged text. Preferences should survive reopening.
3. Select ASTRA 1KR from the GEO list. Check its longitude, owner and approximate
   direction. Filled diamonds are near-stationary; hollow diamonds move. The
   dotted belt is a reference, not every object's orbit.
4. Confirm layer objects can be selected and followed with the drawn viewfinder.
   Calibrate if prompted; directions depend on compass uncertainty and are not
   a precision dish-alignment measurement. Navigation/GEO objects are generally
   too faint to see unaided.
5. Disable layers and confirm the ordinary sky remains usable. Check pass/train
   preview, Back to now, red mode, saved preferences and offline reopen.
6. Check Follow off, Quick Settings explicit restart, native menu return and
   TalkBack if used, especially whether layer checkbox names and checked states
   are announced correctly (native WebView state flags were unreliable). App switching may close the module by host design.

[Exact-artifact staging report](space-watch-0.5.1-staging.md).
