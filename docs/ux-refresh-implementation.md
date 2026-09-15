# UX refresh: reviewed direction and implementation ownership

Historical integration contract for PR #10, based on the PR #11 design review at
`0135bf0`. Fable's corrected presentation slice has since been integrated. The
[verification record](ux-refresh/verification.md) is the current source for
candidate identity, completed checks and remaining phone review.

## Accepted direction

Keep Library / Browse, green-black surfaces, jade actions, restrained type,
worded badges, task-first modules and native host menus. The sampled token
contrasts reproduce the design's stated ratios (text/bg 16.06, muted/surface
7.57, jade/surface 9.08, jadeInk/jade 10.35, error/surface 6.93).

Library entry loads local inventory only. Browse refresh is explicit; opening an
installed tool never depends on a catalog request. Retain the last successful
in-memory catalog with its **own source** if refresh fails; never pair old entries
with a newly edited URL. A source change is an explicit apply/refresh action, not
a keystroke effect. No new persistent catalog cache in this slice.

One prominent latest **normal** release per module; fixtures keep their warning.
Versions remains secondary and lists the highlighted release plus `otherVersions`,
so an explicit review can still select that release when newer code is installed.
Do not label entries "compatible" because the
catalog has no compatibility metadata. Library retains installed modules absent
from the selected catalog. Do not promise every module feature works just because
a module is installed: prefer "Installed tools are available offline."

## Required corrections to the design (Fable)

1. **Real click path:** clicking Browse → Versions empties the document in an
   offline Chromium render. Inline `open('versions')` resolves the document's
   built-in `open`; deep-link screenshots do not exercise this. Rename helpers
   unambiguously (e.g. `openSheet` / `closeSheet`) and bind explicit handlers.
   Verify Versions → review → cancel, plus menu navigation, with real clicks.
2. **Narrow, large text:** an offline render at 360px and CSS font scale 2 found
   Browse app-bar overflow by 47px (hamburger clipped), Settings URL-row overflow
   by 263px, and Android-permission row overflow by 82px. Wrap / stack actions,
   allow long URLs/IDs to break and make the whole content reachable. Retain 1.3×
   but add 2×. This CSS check is not an Android font-scale acceptance result;
   native 2×, landscape and keyboard checks remain Astra's responsibility.
3. **No invented authority:** remove `gallery.export` from Module access. Gallery
   copies use an explicit native confirmation under the existing camera
   workspace grant; there is no separate gallery capability. Render real
   capability labels, notably "Allow camera workspace", "Allow saving data on
   this phone" and "Allow diagnostics". Do not infer both grants from one error.
4. **Mark working stays in the running module's native menu.** Remove the Library
   Mark working button. The trial card can explain "Open and test, then mark
   working in the module menu." Do not bypass the running-session health/digest
   checks by introducing a direct Library confirmation callback.
5. **Recovery and focus stay visible.** Index repair is available only when the
   index is unreadable, with its existing confirmation; no permanent destructive
   reset button for a healthy library. Keep damaged-card Restore/Remove and the
   unreadable-index banner visible in Library. Errors must wrap; only additional
   detail collapses. Modal focus must stay within a sheet/dialog and return to
   the trigger; use native Compose modal primitives for the real UI.
6. **Control contrast and targets:** keep `border` decorative (measured 1.64:1 on
   surface). Add `controlBorder = #6F8C7C` for input/control boundaries that must
   identify an interactive region (4.59:1 on surface, 4.16:1 on surface2).
   Map Material `outline` to controlBorder, `outlineVariant` to decorative border.
   Set container/on-container colour pairs explicitly for tonal buttons/chips;
   don't leave default purple Material roles. Help/delete/details targets also
   meet at least 44 CSS px / 48dp native; rows may grow with text, not fixed 48px.
7. **Prototype hygiene:** use `https://catalog.example.invalid/index.json` instead
   of deployment addresses. Build checklist rows with DOM/textContent, not user
   strings interpolated into innerHTML. Clearly label mocked controls; do not
   claim end-to-end function for decorative buttons. Regenerate affected previews.
8. **Scope corrections:** Snake currently uses API 0.6.0. Astra will move legacy
   first-party manifests to corner-aware 0.6.0 (Measure stays 0.7.0), not bump all
   modules to 0.7 merely for styling. No changes to Snake game logic or its
   interruption protection. Preserve existing confirmation policies; do not add
   a confirmation to every routine checklist edit solely for styling. No new completion-tone toggle or other unimplemented
   controls; reflect the actual module. Timer type is task-specific, not forcibly
   reduced to 40px. Preserve Camera's quota copy and Measure's rotation retention.

## Frozen presentational interface

Astra owns `WorkshopModels.kt` in `dev.construct.runtime`. Its `WorkshopCardModel`
contains ID/title, optional subtitle/version/message, badges, primary action and
secondary actions. Action IDs are typed. The activity supplies labels, enablement,
recovery explanations and callbacks. Models are not install authorization.

Fable owns these **new** files in the same package:

- `core/app/src/main/java/dev/construct/runtime/ConstructTheme.kt`
- `core/app/src/main/java/dev/construct/runtime/WorkshopComponents.kt`

Implement these package-internal functions (Compose annotations implied):

```kotlin
ConstructTheme(content: @Composable () -> Unit)
WorkshopCard(
    model: WorkshopCardModel,
    onAction: (WorkshopActionId) -> Unit,
    modifier: Modifier = Modifier
)
WorkshopStatus(message: WorkshopMessage, modifier: Modifier = Modifier)
```

Card: one primary action; `VERSIONS` may be an explicit secondary button, all
other secondary actions go in the labelled overflow. Do not hide an essential
recovery action with no visible explanation. Render supplied actions only, honor
`enabled`, and call back with their ID. Do not decide which version is installed
or safe to install. Include version in accessible context so identical names
across Library / Versions can be distinguished. Overflow accessible name:
`More actions for <title>`. Locally remembered state may only control expansion
or overflow visibility, keyed by model ID. No IO, ModuleStore, Activity, permission
launcher, package verification or navigation in these files.

WorkshopStatus always shows the problem/next action, wrapping as needed. Optional
technical `details` expands in place. Use semantic headings and state words; no
color-only status. Theme provides explicit Material color pairs and typography;
Astra applies it to host/module/native activities. No image assets or fonts need
network access.

## Fable's bounded implementation slice

Rebase the design branch onto current `origin/feat/ux-refresh` to pick up the
models. Continue draft PR #11 against that branch; update its title/body when it
includes production presentation code. Do not merge it yourself.

In addition to the two new Kotlin files, Fable may change only:

- `docs/ux-refresh/**` (the design corrections above)
- `examples/checklist-module/ui/index.html`, `style.css`, new `construct-ui.css`
- `examples/camera-module/ui/index.html`, `style.css`, new `construct-ui.css`

Use identical shared CSS token values in both copies. Import `/construct-host.css`
for the menu variables, preserve all existing DOM IDs, script filenames, button
availability rules and version placeholders. Keep existing functional labels
where possible; list any deliberate selector changes in the PR. Collapsed help,
corner clearance, responsive layout and status presentation are in scope.
Do not add a fake HTML hamburger to module packages: the host supplies it.
Do not edit app.js, bridge.js, manifests, registry, packages, build files,
MainActivity, ModuleActivity, CameraActivity or MeasureActivity.

Astra owns all those integration/runtime files, remaining module rollout,
state transitions, manifest/API/version updates, publication and Android tests.
If a visual requirement needs JavaScript behavior changes, describe the needed
hook; Astra will implement it. This avoids parallel edits to permission or
storage logic.

## Runtime action rules and acceptance

`CatalogInstallPresentation.choice` handles display labels and enablement:
exact digest = Installed; unconfirmed current trial = test/recover first;
unreadable index/damaged module = repair first; busy = disabled. A newer installed
version is not a prominent Update. Explicit Versions may review older code;
same version with different bytes says Review replacement. All paths still call
prepare → signature verification → consent → install, with store-level gates.

At contract freeze, twelve focused Kotlin/JUnit tests passed for the catalog
projection and action rules; integration and Android acceptance were still
pending. Current results are recorded separately in the verification record.

Fable's handoff: compile the presentational files where tooling permits; exercise
actual mockup clicks, 360px/2× and landscape states, literal checklist input,
focus/target behavior, and include updated screenshots plus stated limitations.
Astra then integrates and verifies the optimized app and signed module versions
on Android 16/17 as appropriate, including real permission dialogs, no-network
Library launch, explicit historical installation, trial/repair/revocation,
keyboard/menu clearance, and photo/measurement lifecycle regression. Preserve
the existing documented Android 17 emulator Snake limitation; don't weaken game
protection to obtain a pass. These were the acceptance requirements before any
new installer or module ZIP could be promoted.


## Integrated UX refresh

The presentation slice is integrated on `feat/ux-refresh`. The host now starts
from local Library inventory, keeps catalog setup under Settings, and exposes one
normal release per module in Browse. Versions uses the existing verified-package
consent and install path; rollback, trial health, damaged-index recovery and
permission checks remain owned by the runtime.

The shared theme is applied to the host, module menu, camera and measurement
workspaces. All eight launchers use the shared CSS tokens and current reserved
corner contract. The camera photo/control split adapts to portrait and landscape;
controls scroll without moving the photo. This changes presentation, not capture,
analysis, export or measurement algorithms.

Candidate module versions: Hello/Checklist/Tones 0.3.0, Focus 0.1.3, Snake 0.1.7,
Contacts 0.2.2, Camera 0.1.4, Measure 0.1.3. Historical signed packages remain
immutable. The earlier Snake 0.1.6 layout candidate was not promoted.

The runner retains legacy host navigation and adds exact module/version card
selection for Library and Versions. `--ux-candidates` runs a separate real-device
UI scope with eight pinned package hashes; individual capability suites remain
separate. Module version overrides pair each requested version with its exact
hash. A UI render or unit-test pass is not Android acceptance.

The optimized candidate, actual Android renders and scoped acceptance results
are recorded in [verification](ux-refresh/verification.md). Android 17's previously
documented emulator Snake interruption remains unresolved; this UX work does not
relax that protection.
