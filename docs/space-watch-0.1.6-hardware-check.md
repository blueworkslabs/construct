# Space Watch 0.1.6 phone check

Status: **passed on hardware** (2026-09-28, pilot tester: "works as expected"),
after [13/13 Android staging checks](space-watch-0.1.6-staging.md). The exact
signed 0.1.6 package (SHA-256 `159262e0b2008b56130f92171eac929048236f0fd565444e639f8e5e42fd299c`)
is promoted unchanged to the production catalog.

No new APK is needed. The staging target is the existing alpha34 candidate.
Use only **Space Watch**, not Synthetic Space Watch, from this isolated catalog:

<https://raw.githubusercontent.com/blueworkslabs/construct/83a16ad3af6cf551fdf9a89fa5a551f39de40098/catalog/candidates/space-watch-016/index.json>

1. Install Space Watch 0.1.6. In Module access, enable approved internet sources.
   For phone location, also enable module location and Android location access;
   alternatively enter a place manually. Coordinates are not stored or transmitted
   by this module.
2. Check the overhead list and tap an object, then try selecting one on the dome.
   The chart is compass-style, **held flat: north up, east right**. It does not
   follow the phone or align automatically.
3. Open Details. Check the orbit/catalog facts and same-launch companions, then
   explicitly request Wikipedia. Scroll to the attribution and close the sheet.
4. Turn on red mode, close/reopen the module, and check it remains red. Try rewind
   and Back to now. Check landscape and your normal enlarged text setting.
5. Once data is loaded, try reopening offline. Cached orbits should remain usable;
   a fresh location may require a cached fix or manual coordinates. Re-enable
   connectivity afterward.
6. At dusk, use the selected object's direction and height to look for it. One
   fist at arm's length is approximately 10°. Match sky anchors before judging
   accuracy. Report whether the direction, motion and timing agree; no photo or
   precise personal location is needed.

The catalog covers a curated bright-object group, not every satellite. “Visible”
means the sunlight/dark-sky/elevation conditions pass; clouds, obstructions,
brightness variation and stale orbital elements can still prevent a sighting.
Follow mode, camera AR and notifications are not included.
