# Aimé 0.2.1 — saved-photo accuracy follow-up

Keep **alpha33** installed. This is a module-only update; no new APK, uninstall or data clearing. Install **Aimé**, not Synthetic Aimé, from [the pinned 0.2.1 candidate catalog](https://raw.githubusercontent.com/blueworkslabs/construct/426216024036a9dbf78770c38ddeed2d97e4ffc9/catalog/candidates/aime-021/index.json).

1. Reopen the **same saved 2× photograph**, with the same marks, viewpoint and horizon points. Do not move/reselect them for the first comparison.
2. Open **Calibration details** (also available through **Lens not measured · why?**). Note the stored zoom, raw camera lens and whether it was used or skipped, the fitted lens and its source, tilt/compass inputs, and the two reference residuals and ±m.
3. If the camera omitted its lens, the default now accounts for stored zoom. A landscape 2× photo starts near **38.6° ±5.3°**, explicitly a prior, not a measured camera lens. The final fitted value can differ. Compare the same target and map pin/ruler offset with your earlier result; do not assume the entire error will disappear.
4. Close/reopen Aimé and confirm the panel, marks and measurements survive. Long landmark names should wrap without hiding their residuals.
5. Optionally take a fresh 2× photo. Alpha33 can still omit lens metadata on the Pixel; this update diagnoses the omission and improves the fallback, but does not fix native lens acquisition. Report whether the panel says the camera omitted the lens or the module rejected supplied geometry.

Screenshots are optional, using the already-confirmed per-module setting. No private photo needs to be shared.

## What has NOT changed

- The APK remains accepted alpha33. Alpha34 is held for an off-centre crop/projection correction.
- Data remains `2026-09-23.1-r2`. The proposed r3 VW Tower snap was incorrect: Telemoritz/VW Tower and Hochhaus Lister Tor are different buildings. No such movement was published.
- Saved marks retain their original coordinates, uncertainty and dataset. A later data update does not silently refresh them; the current comparison isolates the module change.
- Existing photos cannot gain camera measurements that were omitted at capture time.
- Do not edit/save these photos after rolling back to 0.1.9: it can discard their camera metadata. Versions 0.1.2 and earlier additionally cannot preserve cell-based marks.

Physical accuracy and Pixel-specific lens acquisition remain separate from emulator acceptance. No promise that 2× will yield a particular uncertainty reduction.
