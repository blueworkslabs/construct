# Contributing to Construct

Construct is MIT-licensed; see [LICENSE.md](LICENSE.md). Contributions are welcome.

## Design contract

Read the [modular design contract](docs/modular-design.md) before planning a feature.
**Construct provides the runtime and defined capabilities; loadable modules contain
the applications.** Domain logic, provider adapters, feature data and ordinary UI
belong in the module package. Native enforcement and reusable phone/OS facilities
belong in the host. Existing launcher-only native workspaces are migration debt,
not the default pattern for new tools.

State the host/module ownership split, APIs used or proposed, delivery unit and
verification in the issue/PR. A feature-specific host exception needs a documented
constraint, alternatives and exit criterion. Once the required host API exists,
ordinary feature changes should be deliverable through module updates alone.
Coding agents should also read the root [AGENTS.md](AGENTS.md).

## Source of truth

The public repository is the canonical source for ongoing development. Make
reusable host, module, runner and documentation changes here, on reviewable
branches. Build private deployments from this source with the ignored operator
profile and the operator's existing signing identities; do not maintain a second
independently edited application tree. Historical private workbenches remain
archives, not an upstream branch to merge wholesale. Keep keys, operator settings,
raw device receipts and personal data outside public commits.

Start with a small issue describing the behavior, lifecycle
and capabilities involved. UI improvements, reproducibility work, additional
synthetic tests and honest evidence are as useful as adding another native API.

## Change checklist

1. Check the ownership boundary, not just which files changed. Separate a
   module-only change from a justified host/API change. New native authority needs
   host implementation, native enforcement, consent UX and compatibility handling.
2. Keep module versions immutable. If published bytes change, increment the version.
3. Preserve working data across supported updates/rollback, or document the boundary.
4. Run relevant [local checks](docs/reproduce.md). Host changes also need JVM/lint
   and exact-APK Android acceptance; attach reviewed synthetic evidence, not private logs.
5. For UI changes, inspect real Android screenshots in both orientations where
   supported. Account for the host menu rectangle and keyboard/system insets.
6. Describe what failed, what was fixed and which scopes were not rerun. Never turn
   a timeout, stale evidence or a missing control into a pass.
7. For a modular migration, demonstrate different signed module versions changing
   feature behavior on the same host APK; moving code between APK-bundled packages
   is not sufficient. Preserve existing contracts until migration is verified.

Documentation-only changes need consistency and local-link checks, not an APK
build or device run. Clearly separate design proposals from implemented APIs.

Disclose material agent assistance in the change description and review its output
as code. Do not include private conversations/prompts, provider credentials or
personal identities in commits. Retain existing authorship and third-party notices.

Please avoid unrelated formatting churn, automatic module installation, unrestricted
WebView network access or new permission surfaces bundled into a cosmetic change.
Report security issues through the private route described in [SECURITY.md](SECURITY.md)
rather than an ordinary public issue.
