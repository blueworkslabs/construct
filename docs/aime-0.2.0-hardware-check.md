# Aimé 0.2.0 — combined camera/accuracy phone check

Keep the accepted alpha33 installed. No new APK, uninstall or data clearing.
Install **Aimé**, not Synthetic Aimé, from [this pinned candidate catalog](https://raw.githubusercontent.com/blueworkslabs/construct/bcd003bd49e99da1e33e77af8e72678a5265091f/catalog/candidates/aime-020/index.json). Aimé 0.2.0 requires API 0.13 / alpha33. The earlier 0.1.9 catalog remains available for alpha32.

1. Open an existing photo: its marks, viewpoint and horizon should remain. Older photos have no camera measurements; they retain the earlier calibration behavior.
2. Prefer the same public viewpoint as the 0.1.9 test. Use the rear main camera, landscape. At **1×**, aim roughly toward the horizon with the level indicator on. Zero pitch means looking horizontally—not laying the phone flat. Take a photo, confirm/correct the viewpoint if asked.
3. Note whether **Level measured**, **Lens from camera** and (after the first landmark-data lookup) **Compass hint** appear. Missing fields are allowed by the host, but report missing chips: that photo cannot demonstrate the corresponding measured-input improvement.
4. Mark one known landmark, **without horizon taps**. Tap three recognizable targets and note the top-three matches and displayed ±°. Try first-mark direction-sorted search, particularly a tap away from the photo centre.
5. Repeat at **2×** from the same spot and note the same results. Compare observed accuracy and uncertainty; 2× does not guarantee a fixed accuracy gain.
6. Close/reopen Aimé; the new photo's measurements and marks should survive. Check the 2× chip, zoomed photo, magnifier, move/undo and map pin → photo.
7. Screenshot switch: the already-confirmed opt-in should still work. Native camera and private-photo confirmation remain protected; Android 13+ Recents stays hidden.

Report the zoom, measured chips present, top-three matches/±° and any confusing controls. No private photos need to be shared.

## Compatibility and data limits

Do not roll back to 0.1.9 and edit/save new 0.2.0 photos: older Aimé preserves the old mark shape but does not retain the new camera-metadata field when saving. Do not roll back to 0.1.2 or earlier after saving cell-based marks. Existing photographs cannot acquire shutter-time measurements retroactively.

Magnetic heading is only a rough hint and is used only with the viewpoint cell's declination. Metadata can be omitted for stale samples, unsupported/ambiguous camera geometry, unreliable sensors or steep poses. Horizon taps remain available when useful; a mountain/building skyline is not a true level horizon. Landmark data still has gaps: Schloss Marienburg is absent as a castle (Marienberg hill exists).
