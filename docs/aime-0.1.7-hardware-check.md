# Aimé 0.1.7 — hardware check (staging passed; ready for pilot)

Use the existing alpha32 on the Pixel 8a. No APK replacement or uninstall is needed.
Install **Aimé 0.1.7**, not Synthetic Aimé, from the candidate catalog supplied with the completed acceptance receipt. The fixture is for disposable emulator testing only.

Data covers Germany and Austria for this pilot. A partial-coverage warning means some nearby cells are not in this dataset, so the shortlist may miss landmarks. A missing landmark is possible: Schloss Marienburg is absent as a castle in this Overture release (the Marienberg hill is present). The Hermesturm may also be absent. Per-feature position estimates are model assumptions, not surveyed accuracy guarantees.

1. From a public elevated viewpoint, use the main camera in landscape. Take a photo and check/confirm where you stood and the displayed location accuracy. Correct the viewpoint on the map if needed.
2. Mark a known tower, church or peak by tapping it in the photo and selecting the matching landmark.
3. If you can identify a true level horizon, mark two widely separated points. Do not substitute a ridge or rooftop skyline. Skip this when unsure.
4. Tap three other identifiable landmarks. Note whether the expected answer is in the top three, its displayed ±°, and whether the selected map pin is sensible.
5. Add a second known landmark and repeat one tap. Close/reopen Aimé and check that marks and the horizon remain.
6. Try the 10/30/60 km radius picker and report any slow lookup, missing-data error or confusing controls.

Please report phone/model, the names of the marked/tapped landmarks, the top-three outcomes and displayed uncertainty, plus any UI confusion. Sharing the photo or exact viewpoint is optional; they are not needed in a public issue.

The map's bands describe direction uncertainty; nearby candidates have their own additional position uncertainty and can appear outside those bands. That alone is not proof of a ranking bug.

## Update boundary
Old OSM marks survive the forward update. **Do not roll back to Aimé 0.1.2 or earlier after making cell-based marks**: those versions cannot read them, and saving there can erase them. Host photo IDs and originals remain separate from this module-data boundary.

No merge or production module promotion until hardware feedback has been reviewed.

## Candidate catalog

https://raw.githubusercontent.com/blueworkslabs/construct/c807a0e1250f1e8e0b8dd68d61d9fd9e806917f1/catalog/candidates/aime/index.json
