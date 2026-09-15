# Construct UX refresh — shared visual system (design slice 1)

Status: proposal for the design checkpoint in `ux-refresh-brief.md`. One token set
for native Compose and module CSS; the values below are the single source. The
clickable prototype in `mockup.html` uses exactly these variables. Nothing here
is wired into the app yet.

## Tone

Quiet, precise, green-black. The Matrix influence is in the surfaces and the jade
accent, not in effects: no code rain, scan lines, glow text, blinking cursors or
terminal prompts. Monospace only for versions, hashes, timers and measured values.

## Colour tokens (measured)

| Token | Value | Use |
|---|---|---|
| `bg` | `#0B1410` | Window background, behind everything |
| `surface` | `#122019` | Cards, sheets, dialogs |
| `surface2` | `#18291F` | Inputs, chips, nested rows |
| `border` | `#2E4638` | Hairlines, card edges (decorative, 1px) |
| `text` | `#E6F0EA` | Body and titles |
| `muted` | `#9DB3A6` | Secondary text, metadata |
| `jade` | `#5FD3A0` | Primary action fill, links, selected state |
| `jadeInk` | `#06110B` | Text on jade |
| `focus` | `#8CF0C4` | Keyboard focus ring (3px), never body text |
| `amber` | `#E9C46A` | Attention: trial, update available, needs input |
| `error` | `#F08A7E` | Failed, damaged, denied |
| `disabled` | `#5E7268` | Disabled control text and outlines |

Contrast (WCAG relative luminance, computed):

| Pair | Ratio | Passes |
|---|---|---|
| text on bg | 16.1 | AA/AAA body |
| text on surface | 14.5 | AA/AAA body |
| text on surface2 | 13.1 | AA/AAA body |
| muted on surface | 7.6 | AA body |
| muted on surface2 | 6.9 | AA body |
| jade on surface | 9.1 | AA body, usable as link/label text |
| jadeInk on jade | 10.4 | AA body (primary button label) |
| amber on surface | 10.1 | AA body |
| error on surface | 6.9 | AA body |
| focus on surface | 12.3 | ≥3:1 non-text |
| border on surface | 1.6 | decorative only; not a state boundary |
| disabled on surface | 3.3 | non-text minimum; disabled controls also drop to 60% opacity and are never the only cue |

Script used: WCAG relative luminance per sRGB channel, ratio `(L1+0.05)/(L2+0.05)`.
Re-run it when a token changes; the numbers above are not estimates.

State is never colour-only: every badge has a word, and failed/damaged cards also
change their primary action label (Retry, Restore, Remove).

Module theme colours: modules keep declaring `themeColor`; the host paints window
and system bars with it. First-party modules adopt `bg` as their theme colour so
the transition from Library to module is seamless. Snake keeps its own palette
inside the board and controls.

## Spacing, radius, type

- Spacing scale: 4, 8, 12, 16, 24 dp/px. Card padding 16. Card gap 12. Screen gutter 16.
- Radius: 12 for cards and sheets, 10 for buttons, 999 for chips/badges.
- Type (system font, both platforms): title 22/28 semibold, card title 17/22
  semibold, body 15/22, secondary 13/18, label 12/16 caps-free, mono 13 for
  versions and values. Large-font scaling is honoured; layouts wrap, never clip.
- Elevation: none. Depth is one hairline border plus `surface` over `bg`. Sheets
  and dialogs add a 40% black scrim.

## Component roles

- **Primary button** (jade fill, jadeInk label): exactly one per screen or card.
  Open, Install, Confirm, Take photo, Search.
- **Secondary button** (surface2 fill, text label, border): Versions, Undo, Choose
  photo, Retry when not primary.
- **Quiet button** (no fill, jade label): Details, Help, Cancel, Back.
- **Destructive** (no fill, error label, always confirmed): Remove, Discard,
  Delete all photos.
- All targets ≥ 48 dp native, ≥ 44 CSS px with 8 px gap. Focus ring 3px `focus`,
  offset 2px, visible on keyboard focus only.
- **Badge**: chip with icon-free text. `Working` (muted), `Trial` (amber), `Update`
  (amber), `Failed` (error), `Needs repair` (error), `Disabled` (muted), `Test
  fixture` (error text on surface2). At most two per card.
- **Card**: title, one-line purpose, badges, one primary action, one overflow (⋯)
  for secondary actions (Disable, Roll back, Module access, Remove, Discard trial).
  Version shown in mono in the metadata line, not in the title.
- **Sheet**: rises from the bottom, drag handle, title, scrolls internally, Back or
  scrim tap dismisses. Used for Versions and Module access.
- **Dialog**: only for confirmations that destroy or grant (install consent,
  remove, discard, turn off required access, repair index).
- **Status line**: one line under the app bar. Info in `muted`, attention in
  `amber`, errors in `error` with the code in mono. Long errors expand in place
  with a "Details" quiet button; never an expiring toast.

## Host information architecture (mockup screens)

1. **Library** (default). Installed modules as cards ordered by name. Card =
   name, purpose, badges, Open (or Retry/Restore/Reopen), overflow. Empty state
   points to Browse. No network call on entry.
2. **Browse**. One card per module from `CatalogPresentation.cards`: latest
   normal release with Install/Update/Installed state, and a secondary
   **Versions** button that opens a sheet listing `otherVersions` with test
   fixtures clearly labelled and the same verified install path. Refresh lives
   in the app bar; stale/offline state is a status line, not a blocker.
3. **Menu (☰)**: Settings, Diagnostics, About. Settings holds catalog source
   (demo / configured URL with edit), and repair actions. First-use: Library empty
   state carries "Choose a catalog" so nobody has to guess.
4. **Module access**: sheet with friendly labels, required marked, independent
   Android permission rows with their own button and status, Reopen module.
5. **Recoverable errors**: damaged card (Needs repair, Restore x.y.z / Remove),
   unreadable index banner with Repair, offline catalog status with Retry.

## Inside modules (CSS rules, shared file proposal)

Provide `construct-ui.css` inside each first-party module package (no host
change needed, CSP `style-src 'self'` is satisfied) containing the variables and
these rules. Later the host can serve it like `construct-host.css` if wanted.

- Page: `bg` background, 16px gutter, header row reserves the menu corner via
  `padding-right: var(--construct-menu-width, 56px)` on API ≥ 0.5 modules.
- Header: module name at 20/26 semibold, optional one-line purpose in `muted`.
  No version in the header; version goes in the footer in mono.
- Help: collapsed by default behind a quiet "Help" button that toggles a
  `<details>` block. The first paragraph of a launcher is the only always-visible
  prose.
- Status line: `role=status`, one line, same colour rules as host.
- Loading: primary button disabled with label "Loading…", status "Loading saved
  items…", no spinner animation (reduced motion by default).
- Permission denied: status in `error` with the code in mono, one quiet button
  "Open Module access" is not possible from web (host owns it), so the text names
  the exact switch: "Turn on Allow saving data in Module access (☰)".
- Lists: 48px rows, checkbox 24px, delete as quiet destructive icon-button with
  an accessible label.

## Compose mapping

`darkColorScheme(background=bg, surface=surface, surfaceVariant=surface2,
onBackground=text, onSurface=text, onSurfaceVariant=muted, primary=jade,
onPrimary=jadeInk, secondary=jade, tertiary=amber, error=error, outline=border,
outlineVariant=border)`. Buttons map: primary → `Button`, secondary →
`FilledTonalButton`, quiet → `TextButton`, destructive → `TextButton` with
`error` content colour. Badges → `AssistChip`/`SuggestionChip` with the label
and no icon. Typography stays Material defaults scaled by the type table.
