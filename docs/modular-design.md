# Modular design contract

## Purpose and status

**Construct is a defined interface to phone capabilities and a runtime for
loadable modules. The modules are the applications.** Its value is not merely
showing many tools inside one APK: their behavior can be developed, installed
and updated independently against a stable, versioned contract.

This document is the design policy for new work and the direction for migration.
It is **not** a claim that every current feature already follows that policy.
The [implemented API](module-api.md) describes what modules can actually call;
[architecture](architecture.md) describes the current runtime and trust domains.

The host is thin in **responsibility**, not necessarily in line count. Reliable
permission enforcement, isolation, package management, lifecycle handling and
reusable native facilities can require substantial host code. They must not
become a place to accumulate application-specific workflows.

## Ownership boundary

| Responsibility | Owner | Examples and boundary |
| --- | --- | --- |
| Module delivery/runtime | Host | Verify signatures and compatibility; install/update/rollback; isolate runs and module storage. |
| Authority and trusted shell | Host | Grants, Android permission UI, native menu, resource limits, revocation and lifecycle enforcement. |
| Device/OS access | Host capability | Bounded location, camera, contacts or other explicitly supported operations. Return only contract-authorized data. |
| Transport and shared facilities | Host capability where justified | Controlled HTTP transport, reusable rendering or native compute; enforce destination/resource policy without encoding a particular application's meaning. |
| Domain interpretation | Module | Aircraft provider parsing, deduplication, model names, measurement workflow, game rules and timer behavior. |
| Feature presentation and interaction | Module | Screens, filters, selection, units, explanations and ordinary feature controls, within the trusted host shell. |
| Feature data and state | Module, through bounded storage where needed | Domain tables, preferences and data-format migrations. Host storage quotas and access isolation remain authoritative. |

The module owns **policy within a capability's permitted envelope**. For example,
it may choose a refresh interval while the host enforces a hard request budget.
An aviation module interprets airline records; a transport capability validates
destinations and payload sizes. A module can render a map itself or use a reusable
native map surface, but the host surface must not know what an aircraft or a
"Combined" source mode means.

Not every native algorithm belongs in JavaScript. An expensive detector or image
operation may be a reusable native primitive; choosing a reference, interpreting
results and presenting a measurement remain module responsibilities. Do not
generalize speculatively: one well-defined consumer can justify a small capability
if its contract is genuinely independent of that consumer's product workflow.

## The independent-update test

Ask: **with the required host API already installed, can a new signed module
version change this feature without rebuilding Construct?**

- An aircraft glossary correction or provider response-format adaptation should
  be a Sky Watch module update.
- A game rule or ordinary screen redesign should be a module update.
- Supporting a genuinely new Android facility, fixing host enforcement or
  extending the versioned bridge can legitimately require an APK update.

The test concerns installed artifacts, not source organization. A feature moved
into a Kotlin package, Gradle library or separately named component that is still
bundled into the APK has not become an independently loadable module. Conversely,
placing a launch button in a signed ZIP does not move the application there.

Current modules use packaged HTML/CSS/JavaScript and assets. This policy does not
authorize arbitrary downloadable Android code or mandate a new runtime, plugin
system or capability-pack architecture.

## Designing capabilities rather than built-in applications

Start with what the module needs to request, receive and render, then implement
the smallest appropriate host contract. Do not start by building a complete
native application and expose only its launch action afterward.

For a new or extended capability, describe:

1. **Semantics:** requests, results/events, error cases and schema/version rules.
   Could a differently named module use it without feature-specific host edits?
2. **Authority:** manifest declaration, user grant and any Android permission;
   trusted consent belongs to the host. Declarations do not grant access by
   themselves, and module HTML must not impersonate native consent.
3. **Bounds:** input/output size, concurrency, rate, time and resource budgets;
   allowed destinations/data scope when relevant. Keep domain policy separate
   from host-enforced hard limits.
4. **Lifecycle:** cancellation, pause/close/revocation, and stale-result handling.
   Do not rely solely on cooperative module code to stop privileged operations.
5. **Data flow:** what reaches module code, what may be retained or sent onward,
   and how consent explains that composition. Once legitimately delivered,
   revocation is not retroactive erasure of a module's stored copy.
6. **Compatibility:** API negotiation, unavailable-capability behavior, module
   data migration and treatment of existing installed versions.

These requirements now have an initial consumer: Sky Watch 0.2.x uses the bounded
API 0.9 `net.http` and `location.read` contracts. The WebView still has no direct
network or geolocation access. Future capabilities must likewise be designed,
implemented and verified before a module depends on them.

## Current implementation debt

- **Sky Watch:** 0.2.x owns aviation logic and Canvas/UI in its signed module,
  using API 0.9 transport/location/storage. The alpha28 candidate removes the old
  native implementation; old required `sky.watch` callers are manageable but need
  a module update. See the [retirement boundary](shell-retirement.md), including
  data preservation and unsupported rollback handling.
- **Pocket Measure:** 0.2.x owns geometry, calibration, editor, units and UI in
  its signed module. API 0.10 exposes a bounded selected raster and generic marker
  detections with fresh consent. Alpha29 retires the old native workspace; see
  [the image contract](module-images.md). Exact candidate acceptance is separate
  from this ownership statement.
- **Pocket Camera / analysis:** the alpha31 candidate moves album, selection,
  detection presentation, overlays and score filtering into the signed module.
  [API 0.11](module-photos.md) supplies bounded native acquisition, private-photo
  operations and inference with fresh consent; the broad native workspace is
  retired. No continuous frame stream is exposed or claimed. Exact-artifact
  acceptance and physical-phone performance remain separate from ownership.
- **Module-owned examples:** Pocket Snake and Pocket Checklist already keep their
  core behavior in module code. Preserve this direction; not every existing tool
  requires a rewrite.

The native pilots established useful behavior, UI and acceptance evidence. Keep
that baseline working. Their broad `open` capabilities are historical contracts,
not examples to copy for the next feature. The current candidate recognizes their
identifiers for data-preserving recovery, without retaining their implementations.

## Migration approach and acceptance

Migrate incrementally, using Sky Watch as the first boundary exercise rather than
rewriting all modules at once. Use the existing tools and behavioral baseline to
validate the separation before expanding the feature catalog:

1. Inventory its domain logic, presentation and actual device/transport needs.
   Specify the missing reusable contracts and the data/consent changes first.
2. Implement and verify the required host capabilities, preserving old installed
   modules through an explicit compatibility path.
3. Move aviation adapters, merge rules, glossary, metadata interpretation and
   feature UI/interaction into a new immutable Sky Watch module version.
4. Run the behavioral baseline through that module and validate permissions,
   stale replies, cancellation, provider failures and data-preserving updates.
5. **Demonstrate two signed module versions on the same checksummed host APK:**
   change a domain rule or glossary entry, update only the module, and observe the
   changed behavior. Check update/rollback data compatibility as applicable.
6. Retire the legacy feature-specific host implementation only after the migration
   and treatment of old installed modules are documented and verified. Reuse the
   lessons for Measure and Camera without assuming identical requirements.

This is a staged direction, not a promise that the migration fits one host release
or that its proposed capabilities already exist. Functional parity and independent
delivery are both acceptance criteria; neither replaces the other.

## Lightweight change decision

Every feature issue/PR should briefly identify:

- Module-owned behavior/data/UI and host-owned enforcement or primitives.
- Existing APIs used and any new contract required.
- Delivery unit: module, host or both, with the reason a host change is necessary.
- Verification of behavior, relevant access/lifecycle limits and independent
  module delivery. Keep evidence tied to the tested artifacts.

If a platform/performance constraint requires a feature-specific native exception,
record the concrete constraint, alternatives, affected delivery independence and
an exit criterion in the issue/PR. Do not silently relax the architecture or add an
approval ritual for routine work that already follows it. A launcher-only design
must be identified as an exception, not presented as a completed modular migration.
