# Space Watch 0.5.0 mirror and layers staging

Status: **Incomplete: 21/31 passed, stopped at the first layer control. Superseded by 0.5.1.**
No merge, APK release or production-catalog promotion is included.

## Ownership and exact artifacts

Module-owned mirror validation/fallback, orbit classification, layers and guidance
use the existing API 0.14 host. Alpha37 retains native networking consent,
orientation lifecycle and bounded storage. The new `space-data.pages.dev` origin
widens `net.http` scope; no host code or APK change is required.

- Author correction: `8f7bf65`; reviewed refinements: `b0c112d`.
- Signed artifact commit: `875e0bb0fa6e472fc14f846d51fe1397312e12ad`.
- Real 0.5.0 SHA-256: `732d30f8a339d3136092c981fe8eba4ed57ac4d863c7a02665f544570b5b7ad0`.
- Fixture SHA-256: `ebb3d522667b61e01dca4539908f56b4fdb7e1f41cf04db058d54927844a32cd`.
- Unchanged 0.4.1 upgrade baseline: `10dcb4fc379af3606a32f227cafc68f1f77d98c01ab581724975b2eb7aad9e83`.
- Unchanged alpha37 x86_64 APK: `23cd4b27f95fbc0124fbb6cf69af4d80a6cc8534c58e2235b95e24f4526b5477`.

All three served packages have verified hashes and publisher signatures.
Synthetic Space Watch substitutes a running fixture clock, Berlin viewpoint and
saved provider lists; native orientation/storage and live lookups still use the
host. Real-module consent, loading and offline gates are separate.

## Review and local results

- Empty/duplicate mirror rows fall back rather than replacing good data.
- Interrupted layer downloads restore their retry state; in-flight toggles do
  not duplicate requests.
- GEO-group membership does not imply a stationary orbit. BeiDou IGSO-6 moves
  over 30° in elevation in six hours and now has ordinary motion/rise wording.
- The initial ≤5° / ±2% mean-motion classifier still called ELEKTRO-L 3 parked
  despite about 3.1° longitude drift/day, and called horizon-crossing GS-1
  permanently below the horizon. The revised conservative display heuristic
  uses sidereal rate 1.0027379 ±0.0005 rev/day, inclination ≤1° and eccentricity
  ≤0.001. This is not proof of station keeping; even filled diamonds stay
  **near** a spot, dish guidance is approximate, and no object is said never
  to rise solely from this classification. Fixture counts: 119 parked,
  63 inclined, 8 drifting/eccentric.
- Cached layer composition deduplicates after asynchronous downloads, so an
  object in both lists appears once even when navigation completes later.
- 24 orbit/model groups, controller regressions, real-browser UI/layout checks,
  19 package/publisher tests, 98 Android-runner helper tests and architecture
  checks pass. The new drift regression fails on the prior classifier.

Review and fixes assisted by Codex. Emulator checks cannot establish physical
compass accuracy, sky alignment, precise dish alignment or real TalkBack behavior.

## Consent and fallback are different tests

On alpha37, declining the widened origin scope disables **all** `net.http`,
including CelesTrak. Per-origin approval is not supported. Saved orbits remain
usable. The native upgrade gate tests old approval invalidation, denial and
regrant. Mirror-down/malformed/stale-index fallback is tested separately in the
controller; it is not evidence of selective native source approval.

## Android run

`20260930T062141Z-space-24255f9c` passed 21/31 and stopped at the first layer control. Android exposed the ARIA switches without names or checked state; the visible dialog looked correct. Native checkbox semantics and explicit labels are corrected in 0.5.1. The emulator stopped with Result=success, ExecMainStatus=0, MainPID=0.
No partial results are acceptance. Required coverage includes native Follow and
pointing, baseline trains/lookups/layout, new layer switches and persistence,
0.4.1→0.5.0 consent upgrade, real denied grants, automatic live loading and
offline reopen. Captures and independent teardown will be reviewed afterward.

[Phone checklist](space-watch-0.5.0-hardware-check.md).
