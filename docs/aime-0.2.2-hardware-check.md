# Alpha34 + Aimé 0.2.2 — fresh-photo follow-up

Install the tested **alpha34 ARM64 APK over alpha33** from [the unpublished draft](https://github.com/blueworkslabs/construct/releases/tag/untagged-9e4ae8892cef8a1cc609) (repository access required). Do not uninstall or clear data. Then update **Aimé**, not Synthetic Aimé, from [this pinned 0.2.2 catalog](https://raw.githubusercontent.com/blueworkslabs/construct/bc34cff1a6b7c1d245ae108dd7087b89358aca9d/catalog/candidates/aime-022/index.json).

## Before taking a new photo

- Open an existing saved photo. Confirm its marks, viewpoint, zoom and measurements remain.
- Open Calibration details immediately. With internet allowed, Hannover's viewpoint cell should supply **4.1° E declination**, and the open panel should update when it arrives. A missing/denied fetch leaves the compass unused; it must not invent a correction.
- The screenshot setting should remain as selected. With opt-in enabled, check foreground screenshots, then Recents from both the module and a private-photo confirmation. The tested settled task contents should be blank. Also try a slow/cancelled Recents gesture and returning to the app; report any exposed pixels or a screen that stays black. Native capture/private-photo dialogs remain screenshot-protected.
- Saved mark positions never refresh automatically. An **Update** offer only appears if a different current dataset supplies a changed same-name/same-kind match nearby. Review the displayed move/±m before applying; it is undoable. With existing r2 marks and unchanged r2 data, no update is expected. Do not change marks for the initial same-photo comparison.

## Fresh daylight photo

1. At the same viewpoint, take a **2×** photo with level on. Zero pitch means the rear camera points toward the horizon, not that the phone lies flat.
2. Check **Lens from camera** and Calibration details. The native capture-result fix needs this Pixel test: the emulator does not reproduce a logical multi-camera. If lens metadata is omitted, the panel shows that; use native **Diagnostics → CAPTURE_FOV** to read the source or reason. `capture-result` shows the new path, `characteristics` the conservative fallback. Unsupported crop/lens/sensor fields are omitted, not guessed.
3. Use recognizable **Rathausturm** and **Conti-Turm** reference points on opposite sides of your target; add Telemax only if it fits and is clearly identified. The displayed ±m is an estimate, not a surveyed guarantee. Avoid choosing a name merely because its uncertainty is small.
4. Without horizon taps initially, tap the same power-station feature and place the same map pin. Record the offset, top-three candidates, displayed ±°, and Calibration details. If the target lies outside your references, check the new left/right or second-mark hint.
5. If practical, take a **1× comparison** without changing viewpoint and repeat with well-spread references. No fixed accuracy gain is promised; compare observed error with the reported uncertainty.
6. Reopen the new photo after restarting the app. Measurements and marks should persist.

No private photo is required. Optional screenshots of Calibration details and the relevant CAPTURE_FOV line are useful; review Diagnostics content before sharing.

## Data and compatibility

Dataset remains **2026-09-23.1-r2**. Proposed r3 is held for plant/stack classification and deduplication corrections; VW Tower was not moved onto Lister Tor. This run does not publish new landmark positions or chimneys.

Old photos cannot acquire lens/sensor measurements omitted at their original shutter. Do not edit/save in Aimé0.1.9 after rollback: it can discard capture metadata. Aimé0.1.2 and earlier also cannot preserve cell-based marks. No uninstall or data-clearing step is needed.

Known follow-up: [map capture-loss cleanup #45](https://github.com/blueworkslabs/construct/issues/45). An unusual interrupted map gesture may leave a pending hold/pointer. If an unwanted pin appears or map gestures stick, clear the pin/reopen the module and report it. Normal cancellation/pause paths and ordinary Android gestures passed; the fix is reserved for the next immutable module version.
