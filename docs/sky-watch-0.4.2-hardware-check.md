# Sky Watch 0.4.2 phone checklist

Status: **ready for physical-phone checks — 24/24 Android gates passed in one
uninterrupted run, with independently verified clean teardown.**
Use alpha37 or later with API 0.14. No new APK if alpha37 is installed.
Production stays on the previously released module until an API 0.14 host release.

[Immutable candidate catalog](https://raw.githubusercontent.com/blueworkslabs/construct/f2845cdd5739929a4926774c1928812f8f9001d3/catalog/candidates/sky-watch-042/index.json). Install **Sky Watch**, not Synthetic.

1. Allow the optional compass-and-tilt capability in Module access. Without it,
   the normal map should remain usable and Follow should explain the missing grant.
2. Use your current location (or coordinates where you are). Flat, turn through
   north/east/south/west: tiles, aircraft and the north badge should turn together.
   Pan, pinch, double-tap and select aircraft without unexpected jumps.
3. Select an aircraft and check the left/right bearing words. Raise the phone:
   the viewfinder should replace the map. Check high aim, rolling the phone,
   selected guidance and the unselected “In the middle” identification.
4. Compare with actual visible aircraft in open sky. Treat pointing as approximate,
   not a measured alignment: altitude is barometric above sea level and your
   height is unknown. Errors can be large nearby or over high ground. Aircraft
   without altitude must not be placed or locked in the viewfinder.
5. Check portrait, landscape, enlarged text and TalkBack names/announcements,
   especially calibration recovery and the Follow on/off state.
6. Off releases Follow; the native menu pauses it. Quick Settings must end it and
   require an explicit tap to restart. Revoking compass prevents restart. A fresh
   process starts off. App switching may close the module by host design.
7. Check live provider changes, aircraft info, saved preferences and an offline
   error without a crash. Report compass quality separately from feed accuracy.

[Exact-artifact staging report](sky-watch-0.4.2-staging.md).
