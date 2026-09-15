# Module and native workspace adjustments (design slice 1)

Companion to `design-tokens.md`. "Now" = consistency work for this phase, done
with the shared CSS and tokens, no behaviour change. "Later" = outside this phase.

## Hello (API 0.1 → 0.7)

Now: adopt shared CSS, header with corner padding, footer version, help block.
Manifest bump to the corner-aware API so the top strip disappears. Keep the two
demo buttons; they are the smoke test.
Later: nothing.

## Checklist (API 0.1 → 0.7)

Now: shared CSS; input and Add on one row that wraps at 360px; 48px rows with a
24px checkbox and a quiet destructive delete with an accessible label; summary
as secondary text under the header; status line rules; "Clear completed" as a
secondary button that only appears when something is completed. Keyboard: the
input keeps focus after Add; the list scrolls, the input row stays visible above
the keyboard. Manifest bump for the corner.
Later: reorder, due dates. Not this phase.

## Tones (API 0.2 → 0.7)

Now: shared CSS, two large primary-style pattern buttons in a row, status line
uses the denied/muted rules with the exact Module access switch name. Manifest
bump for the corner.
Later: none.

## Focus (API 0.6)

Now: align type and colours; the countdown stays mono at 40px; move the long
"no background alarm" paragraph into help; keep the completion-tone toggle as a
secondary control next to Start.
Later: notifications. Explicitly out of scope.

## Contacts (API 0.6)

Now: search field and Search on one row, Browse as a secondary button on the
same row (wrapping at 360px); results as 48px rows; detail view header uses the
card title style; labels for phone types in `muted`; denied states name both
gates in one line. Landscape with keyboard: results list scrolls under the
fixed search row.
Later: favourites, calling. Out of scope.

## Camera launcher (API 0.4 → 0.7)

Now: cut the launcher to purpose line, one primary action, status, expandable
help containing the privacy and quota paragraphs. Replace the "Both access gates"
hint with a status line that reflects the actual state when the host reports
denial. Correct copy: rotation and backgrounding close the camera (true today).
Native workspace: shutter, switch camera and album are task actions and stay
on screen; align their button roles with the tokens (shutter = primary,
switch/album = secondary, delete = destructive with confirmation).
Later: gallery export is already shipped natively; no launcher change needed.

## Measure launcher and workspace (API 0.7)

Now: same launcher cut as Camera. Fix stale copy: rotation retains the workspace
(alpha 17). Native workspace keeps everything from slice 1; only recolour the
sheet and buttons to tokens and use the shared badge for the calibration chip.
Later: multiple measurements, saving, shapes (slices 2 and 3 of the measure plan).

## Snake (API 0.5)

Now: header type and chip style to tokens; nothing else. Board, controls,
animations and gestures unchanged.
Later: none.

## Native host screens

Now: Library/Browse/menu per the mockup, tokens as the Compose colour scheme,
badges with words, one primary action per card, overflow for the rest, Versions
sheet, settings under the menu, error states as specified.
Later: catalog search, module categories, per-module icons. Out of scope.

## Runner impact (for Astra)

Selectors that will change: card titles no longer contain " · version";
"Review & install" becomes "Install" / "Update" on the latest card and lives in
the Versions sheet for other versions; "Use demo catalog" moves to Settings;
"Refresh catalog" moves to the Browse app bar. Accessibility labels for the
overflow menus should be "More actions for <module name>".
