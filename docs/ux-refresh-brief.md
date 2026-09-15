# Construct UX refresh — lead and design handoff

Status: **active design checkpoint**, based on merged Android-17/Nano PRs #9/#8
(`215e547`). Working branch: `feat/ux-refresh`. No new APK or module package has
been published for this refresh. Astra leads integration and acceptance; Fable is
the requested UI/UX collaborator. The operator handles the invitation/mentions.

## Goal

Make Construct and its modules feel like one quiet, well-made set of local tools.
Pocket Snake is the reference for compact layout, useful content taking priority,
and host interactions living in the native corner menu. It is not a template
that every task must copy literally. Introduce a restrained Matrix influence in
the host: dark green-black surfaces, jade highlights and precise geometry, not
code rain, flashing scan lines, neon body copy or decorative terminal prompts.

The Nano experiment is concluded for now: the operator still reports UNAVAILABLE
after Android 17/system updates. The precise eligibility cause remains unknown.
Do not add Nano, cloud fallback, chat or new capabilities to this phase.

## Audit: actual starting points

- `MainActivity.kt` mixes the workshop, catalog URL/source controls, status text,
  inventory, every catalog version, grants, repair, diagnostics and consent.
  It uses the default Material dark scheme. A simple skin will not remove this
  information overload.
- `ModuleActivity.kt` already owns the hamburger menu, Back/menu behavior,
  diagnostic overlay and pause/resume boundary. **Do not add HTML replicas** of
  Close module, Module access or Diagnostics to module toolbars.
- `ModuleLayout.kt` reserves a 56 dp / CSS-pixel corner rectangle with a 48 dp
  native target. Corner-aware API versions are 0.5/0.6/0.7. Earlier modules get a
  whole top strip (portrait) or right strip (landscape); removing this blindly
  would overlay controls. Native safe-area/keyboard padding is already applied.
- Hello, Checklist, Tones and Camera source templates still declare old APIs
  (0.1, 0.1, 0.2, 0.4). They need coordinated layout + manifest updates to reclaim
  the corner, not just a host-side removal of protective spacing.
- Snake, Focus and Contacts already have corner-aware layouts and theme colors,
  but use different typography, colors and help/status density. Preserve Snake's
  board, controls and behavioral polish while aligning the shared details.
- Measure uses API 0.7 and native photo-first placement UX. Preserve its fixed
  photo coordinates, zoom/loupe, dragging, Undo and rotation retention. Its web
  launcher's text still says rotation closes the workspace: correct that stale
  copy when polishing the launcher, without changing the actual lifecycle rule.
- Camera/Measure launchers contain substantial implementation-oriented prose.
  Keep a brief purpose, primary action, actionable state, and expandable help.
  Native shutter/capture, photo navigation, analysis, calibration and endpoint
  controls are **task actions**, not host administration to hide in a hamburger.
- Hello and Tones are demos but remain usable modules: style them consistently.
  Deliberately failing isolation fixtures stay a distinct testing surface, not
  ordinary recommended tools.

## Proposed information architecture (design can refine)

1. **Library first:** installed modules with clear names, a concise purpose where
   known, one primary Open/Retry action, and small meaningful state/update badges.
   Keep repair/recovery obvious when needed. Routine status/version text should
   not dominate every card.
2. **Browse:** one prominent card per module, showing its latest normal release.
   Avoid making the user scan a wall of historical versions. An optional, collapsed
   **Versions** affordance exposes history/test versions without replacing rollback.
3. **Host menu/settings:** catalog source/edit URL, demo/configured source choice,
   diagnostics and About/version belong here. Refresh should remain discoverable
   from Browse. First-use setup must not require guessing where the catalog lives.
4. **Module access and consent:** shared visual treatment and clear labels; retain
   explicit opt-in, independent Android permission gates, cancellation, required-
   access revocation confirmation and useful recovery. Error details can expand;
   the problem and next action must be visible without opening diagnostics.
5. **Inside modules:** task first, restrained header, reserved native menu corner,
   consistent buttons/inputs/focus states, concise feedback, progressive help.
   Keep results, destructive confirmations and active errors accessible.

No forced network refresh before opening installed tools. Distinguish a stale/
offline catalog from broken installed code. Do not imply every module works
without its prerequisites (permissions, calibration or available native feature).

## Catalog contract / groundwork

`CatalogPresentation.cards(validatedCatalog)` supplies `CatalogModuleCard`:

- `latest`: the highest numeric major.minor.patch **non-test** release for that
  module ID; if all entries are test fixtures, the newest remains explicitly marked.
- `otherVersions`: every other original entry, descending by numeric version.
  This is **Versions**, not necessarily “Older”: a deliberate broken fixture can
  have a higher version number than the recommended normal release.
- Cards are ordered by display name, then module ID. Identity is never the name.
- This is presentation only. Original artifact/hash/signature/fixture fields are
  preserved. No package, registry entry or installed state is removed or mutated.
- The current schema has no per-version host-compatibility metadata; **do not
  invent “latest compatible” badges**. Existing package verification enforces that.
- Installed modules absent from the current catalog still appear in Library.
  A newer installed build must not be presented with an automatic downgrade.
  Trial/failed/disabled/damaged states and Mark working/rollback remain meaningful.
- Install/update stays explicit through the existing verified-package/consent
  path. No auto-install, regrant or silent “mark working.”

The projection has focused JVM coverage for numeric ordering, large components,
fixture separation, same-name IDs, original artifact identity and empty/history
cases. It is **not wired to the workshop UI yet**, so existing behavior/automation
is unchanged until the integration slice. The shared parser DTO was moved into
`CatalogVersion.kt` without changing its fields or parsing contract.

## Visual system (Fable to specify/refine)

Provisional direction, not frozen color tokens: green-black background, distinct
slightly lighter surfaces, muted jade primary, off-white body text, amber attention
and a separately identifiable error color. Use monospace sparingly for versions,
timers or technical values, not all reading text. No external fonts/assets/CDNs.
Prefer shared spacing/radius/type/button roles to forcing identical layouts.

- Normal-text contrast at least 4.5:1; important control boundaries/focus at least
  3:1. Measure the chosen palette, including muted and disabled treatments.
- At least 48 dp native action targets; comparable comfortable CSS targets.
  Keep the existing 56 px reserved menu area free; account for large titles,
  landscape and cutouts without applying insets twice.
- Test narrow portrait (360 CSS px), landscape, keyboard-visible Contacts/Checklist,
  and large font scaling. Wrap controls rather than clipping actions/results.
- Preserve native accessibility labels and visible keyboard focus. Do not convey
  install/update/failure state by color alone.
- Reduced motion; no persistent decorative animation or added idle workload.
  Native secure photo screens stay secure. Use synthetic fixtures in previews.

## Work split and next concrete checkpoint

**Fable — first design slice (ready for the operator's invitation):**

1. Create a self-contained, code-native clickable mockup under `docs/ux-refresh/`
   (e.g. `mockup.html`, no external network resources) for Library, Browse/latest,
   Versions, host menu/settings and a recoverable error state. Label it a design
   prototype, not a functioning app. Include narrow/landscape variants.
2. Specify shared native/CSS design tokens and component behavior. Show two module
   applications: Checklist's input/list and Camera's launcher. Include a compact
   treatment for help, permission-denied and loading states.
3. Propose the small adjustments for the remaining modules and native workspaces,
   separating immediate consistency fixes from features outside this phase.

Keep this first slice in new `docs/ux-refresh/` files on a separate branch based
on `feat/ux-refresh`; open a draft PR back to that branch. Do not edit
`MainActivity`, runtime/permission/storage code, manifests or signed packages in
this design slice. No need to implement every screen before feedback.

**Astra:** owns catalog projection/action decisions, MainActivity wiring, shared
native theme integration, module contract/version updates, release signing and
acceptance. After the design checkpoint, assign non-overlapping presentational
Compose/CSS files to Fable; agree the component/state interface before parallel
runtime integration. Both keep a shared design spec, not separately drifting
native and CSS token sets. Existing module storage formats stay unchanged.

## Delivery sequence

1. Review the mockup and freeze the small shared visual/state contract.
2. Implement host Library/Browse/menu and latest-first catalog, retaining recovery.
3. Apply shared patterns to Hello, Checklist, Tones, Focus, Contacts and Camera;
   align Measure/Snake without regressing their specialized layouts/gestures.
4. Publish immutable new signed module versions and a tested host candidate.
   Retain old artifacts for rollback and explicit Versions access; do not rewrite
   old package bytes or remove the historical/test registry.
5. Adapt the runner to open explicit Versions controls instead of assuming a flat
   historical catalog. Preserve exact module/version/hash checks; do not retain
   awkward product copy solely to satisfy an old selector.
6. Verify native/JVM/host/module checks, actual APK/registry signing continuity,
   portrait/landscape/large-font/keyboard and error states. Pixel checks focus on
   appearance and interaction, not a request to repeat every regression manually.

Android 17 Snake emulator auto-pause remains a recorded runner limitation. The
operator reports the requested Pixel check passes; this does not fix the runner.
Use the preserved Android-16 profile for automated gameplay where appropriate,
and keep platform-specific evidence explicit. No arbitrary pause-threshold or
assertion relaxation to obtain a visual-refresh pass.
