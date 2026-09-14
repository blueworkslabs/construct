# Pocket Measure: next UX review brief

Status: proposed follow-up after the optimized pilot's Pixel check. No broad UX
redesign is implemented in alpha 16. Fable is the intended UX reviewer; the human
handles the invitation/mention.

## What is already useful

The human reports successful measurements across multiple real-world settings,
including strongly angled photos. The goal is convenient approximate tabletop
measurement, not metrology. Preserve the proven reference-marker and two-endpoint
workflow while making it easier to use repeatedly.

## Primary task

Choose a photo → confirm the printed marker's actual side length → choose the two
ends of an item → read its approximate length → correct or measure another length.

## Review priorities

1. **Give the photo space.** Explore a compact setup panel and a measurement mode
   with clear instructions. Once endpoint selection begins, the image must not
   move when status/result text changes. Small screens and large fonts matter.
2. **Place and correct endpoints.** Consider zoom/pan, a magnifier, draggable handles
   and undo/reselect. Distinguish panning from setting a point; avoid hiding the
   endpoint under the finger. Do not assume every suggestion must ship together.
3. **Make calibration understandable.** Show what part of the printed marker to
   measure. A physically scaled print is valid when its actual size is entered.
   Explore retaining a preferred size without silently treating it as confirmed
   for every reference card or photo.
4. **Make the result readable.** Units, endpoint labels and line contrast should
   work against varied photos. Display rounding is not an accuracy guarantee;
   keep the reference-plane limitation understandable without dominating the UI.
5. **Recover clearly.** Missing/duplicate/small markers, a canceled picker and
   starting over need useful next actions. Review Back/Close expectations before
   changing the established ephemeral-workspace behavior.

## Boundaries to preserve or explicitly revisit

- Selected-photo access through the native picker; no broad gallery permission.
- Native, on-device analysis. No image/URI/endpoint/result access for module JS.
- Explicit per-module grant and revocation checks.
- Points must lie approximately in the reference card's plane; no height/3D claim.
- Originals remain unchanged. Current results are ephemeral and not exported.
  Saving/sharing annotations would be a separately scoped feature, not implied by
  a new visual treatment.

## Suggested review output

A prioritized sketch/interaction proposal for the primary task, including one
narrow/large-font layout and endpoint-correction behavior. Separate immediate
usability fixes from later features. Use the repository's synthetic fixtures;
the user's reference photos stay private.

Acceptance should combine exact photo-coordinate/bounds checks, synthetic known
lengths, lifecycle/grant regressions and a focused real-phone interaction check.
Visual polish alone must not invalidate the existing measurement geometry.
