# Alpha34 phone check

Install **ARM64 over alpha33**, without uninstalling or clearing storage. Verify existing photos and Aimé marks remain. Source af57ff9; signer unchanged. Host 8/8 emulator checks passed, 243 JVM tests and lint passed, with one recorded stale-tilt retake.

## Privacy

With Allow screenshots enabled, foreground screenshots should work. Open Recents from Aimé and from a native private-photo confirmation; contents should be hidden. Try slow and cancelled app-switch gestures, then return and confirm the UI is usable. A confirmation must never approve or cancel itself. Turn Allow screenshots off and confirm blackout returns. Native camera and photo-confirmation screenshots stay protected regardless. Alpha34 fixes a live-Recents leak reproduced in code shared with alpha33; earlier black-frame evidence was insufficient.

## Fresh photos with Aimé 0.2.2

At the same viewpoint, take 1× and 2× photos, level indicator on, initially no horizon taps. Use identifiable references spread across the photo (Rathausturm, Conti-Turm; Telemax if visible), then compare the same target tap and map pin. Record Calibration details, displayed uncertainty and approximate offset. These landmark uncertainties are estimates, not survey guarantees.

Look for Lens from camera. Whether present or absent, Diagnostics → CAPTURE_FOV should give its source/omission reason. The emulator verifies capture-result geometry, not whether the Pixel supplies the needed still-frame metadata. Existing photos cannot acquire missing shutter measurements retroactively.

Zero pitch means pointing the camera horizontally, not laying the phone flat. Unsupported, stale or off-centre measurements are deliberately omitted. Dataset remains r2; r3 is held. No automatic saved-mark movement, public release or production promotion.
