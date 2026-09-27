# Aimé 0.1.9 — precision controls hardware check

Status: **cleared for the phone controls pilot** after 18/18 Android acceptance checks, reviewed screenshots and clean shutdown. Physical-phone feedback remains the next gate.

Keep the existing alpha32 APK. This is a module-only update; the screenshot switch, native level indicator, 2× camera zoom and measured capture metadata are NOT in this candidate (host #42 is separate).

Install Aimé, not Synthetic Aimé, from:
https://raw.githubusercontent.com/blueworkslabs/construct/5489c34095e0597a127bf78fe1782b8fd502975b/catalog/candidates/aime/index.json

1. Open a calibrated photo. Hold on the photo until the magnifier appears, move for precise placement, then release. Check that placement feels right and occurs only once.
2. Drag an existing landmark and a horizon point. Undo each move; check that the original position and fit return. Reopen the photo to confirm saved edits persist.
3. On the map enable Ruler, tap two points, and check distance/bearing. Drag to pan, including near your viewpoint ring: this must not move the saved viewpoint while ruler mode is on.
4. Long-press the map away from the viewpoint ring to drop a pin. Choose Show pin in photo. Check its labelled bearing line/band; a known off-screen target should show an edge arrow or behind-you message. Clear it.
5. Tap a landmark in the photo, then choose Show in photo from its candidate row. Check the same target is indicated, including in a slightly rolled photo. This is a bearing line, not an exact height/pixel prediction.
6. Try landscape and larger system text. Report missed/duplicate touches, clipped labels, confusing controls, and whether known targets are plausible.

For accuracy feedback, mark a known landmark and optionally two points on a true level horizon (not a ridge/roof skyline). Check three recognizable targets, add a second landmark, and repeat one. Record top-three matches and displayed ±° where practical.

Photos/viewpoints remain private unless you choose to share them. Known data gaps remain (including Schloss Marienburg as a castle). Estimates are not survey guarantees. Do not roll back to Aimé 0.1.2 or earlier after saving cell-based marks. No APK replacement/uninstall is required.
