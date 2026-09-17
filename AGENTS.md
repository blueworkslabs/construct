# Construct: guidance for coding agents

These project instructions apply throughout this repository, including work done
by delegated coding agents. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[modular design contract](docs/modular-design.md) before planning changes. Consult
the [implemented API](docs/module-api.md) before assuming a capability exists.

## Architectural invariant

**Construct is a defined, versioned interface and runtime for loadable modules.
Modules contain the applications; the host is not a collection of built-in apps.**

- Put domain logic, provider adapters, domain data/glossaries, workflows and
  feature-specific UI in the signed, downloadable module package.
- Keep installation/signature verification, module isolation, grants, native
  permission UI, lifecycle enforcement and bounded device/OS access in the host.
- Host-mediated networking, rendering or compute may be appropriate as reusable
  capabilities. The host enforces resource/access limits; the module decides what
  the feature means and how it behaves within those limits.
- Design from the module contract first. Do not default to a new Kotlin Activity
  implementing the whole feature with a module that merely calls `open`.
- A new phone/OS capability can require an APK update. A model-name correction,
  provider parser, game rule or ordinary module-screen change should not.
- Moving feature code to another Gradle package or APK-bundled library is not
  independent module delivery. Follow the shipped bytes, not the folder names.

## Before implementing a feature

Record briefly in its issue or PR:

1. Which behavior/data/UI belongs to the module, and what remains host-owned.
2. Which implemented APIs suffice; any missing reusable capability and its
   request/result/event, grant, bounds, cancellation and compatibility contract.
3. Whether the change ships as a module update, a host update, or both, and why.
4. How independent module updating and the relevant security/lifecycle boundaries
   will be verified. See the checklist in the design contract.

If native performance or platform constraints justify an exception, document the
specific constraint, alternatives and an exit criterion. Do not silently turn
one complete application into a supposedly generic capability. Avoid inventing
a broad framework or changing the runtime when a small reusable contract suffices.

## Existing exceptions are not templates

`sky.watch` and `photo.measure` currently open host-owned workspaces; the camera
workspace also includes feature-specific behavior. These are documented migration
debt, not precedents for new module architecture. Preserve their published
contracts while migrating deliberately; do not remove working functionality or
rewrite unrelated modules opportunistically. Prototype success is useful behavior
evidence, not proof of correct code ownership.

## Preserve the trust and delivery boundaries

- Do not gain modularity by enabling unrestricted WebView networking, filesystem
  access, arbitrary native code or ungranted sensor/data access.
- Keep trusted consent and native enforcement outside module control. A declared
  capability or a valid signature alone is not runtime authorization.
- Use explicit, bounded contracts for data passed to modules; recheck authority
  for asynchronous delivery. Do not describe proposed APIs as implemented.
- Follow CONTRIBUTING for immutable package versions, data-preserving updates,
  exact-artifact evidence and private deployment/signing material.
- Match checks to the change and state their limits. Documentation-only edits
  require consistency/link checks, not APK builds. Existing device evidence must
  stay tied to the actual APK/module bytes tested.
