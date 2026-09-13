# Build, publish and test tooling

- `prepare_fixtures.py`: complete synthetic JVM fixtures and example registries.
- `build_demo.py`: local publisher identity, signed Hello and pinned public key.
- `publish_module.py`: validate/package/sign and publish immutable versions.
- `configure_host.py`: ignored registry/host-specific public-CA build profile.
- `setup_runner.py`: stage an explicitly configured disposable runner in a new directory.
- `android-runner/`: actual Android acceptance, scoped receipts, screenshots and cleanup.
- `check_registry.py`: explicit HTTPS catalog/signature/routing verification.
- `test_*.py` / `test_*.cjs`: publisher/configuration and deterministic module checks.

See [building](../docs/building.md), [runner setup](../docs/android-runner.md) and
[workflow](../docs/workflow.md). Generated artifacts belong in ignored `dist/`;
private keys stay outside the checkout. Use each CLI's `--help` for arguments.
