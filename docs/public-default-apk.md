# Alpha22: public catalog default

Alpha22 changes the pilot's deployment configuration to
`https://construct-20x.pages.dev/index.json` and makes a fresh installation use the
configured catalog instead of the bundled demo. It retains alpha21's UX and
capabilities; the version code increases to 22 for an in-place upgrade.

Launch remains local-only: open Browse and refresh to contact the catalog. No
automatic startup fetch, module installation, permission grant, or data migration
is added. Source builds without a deployment profile still default to the offline
demo. An explicit saved catalog choice, including the demo, always wins.

For an existing installation that saved the previous local catalog, select
Settings → Use configured registry → Use catalog once. The new URL is prefilled;
there is no need to type it. A saved custom catalog is not silently overwritten.

Official pilot build configuration (generated resources stay ignored):

```sh
python3 scripts/configure_host.py --registry https://construct-20x.pages.dev/index.json
```

Use system certificate trust only; no private/local CA is needed for this host.
Keep the existing pilot signing identity, publisher public key, module assets,
and bundled native models. Publish the exact verified APK and checksums through
GitHub Releases. Do not overwrite the alpha21 release asset.

Acceptance scope: default selection and saved-choice regressions; final packaged
URL/system TLS, signer, version, permissions and protected assets; a targeted
Android fresh-install and upgrade check. Broader alpha21 capability acceptance is
historical evidence, not a claim that all those suites were rerun for alpha22.

## Verified candidate — 2026-09-15

Frozen app source: `aa1dd0b8aa76e2ff126e8ca3af323d924732c982`.

- Local optimized build succeeded in 13m04s; 137 JVM tests passed, zero failures,
  errors or skips. Lint: zero errors, 18 existing warnings and three informational
  findings.
- ARM64 APK: 23,592,699 bytes; SHA-256
  `f952ac6eee9ba09db2db19ac1dcfa52531aefc47de23fd0bd603db9eec9ec6d6`.
- x86_64 acceptance APK: 26,476,284 bytes; SHA-256
  `162b103bc1af03f21b047bd2ab9398168e7be6f8685f016c72cade052a9c4371`.
- Both packaged URLs and system-only network-security resources verified. No old
  local CA remains. Version22/non-debuggable, original signer, unchanged app
  permissions, 16 KiB ZIP alignment, all 17 protected assets and all native library
  bytes match the corresponding alpha21 split. Managed DEX bytes match across the
  ARM64/x86_64 candidate splits.

### Targeted Android evidence

Android16/API36 x86_64, WebView133.0.6943.137, app-free snapshot, non-root ADB.
An explicit disposable-image-only Digital Wellbeing override was recorded.

Three fresh-install checks passed: the public Settings value without typing;
actual Android HTTPS catalog fetch and signed Hello0.3 installation with stored
counter; offline reopening with retained data after process restart.

That first run subsequently stopped before the APK upgrade: the driver selected
bundled Hello0.2.1, which is deliberately a JavaScript startup-failure fixture.
It is an incomplete overall run, not a six-check clean pass. Its positive first
three checks and failure receipt were retained.

A separate clean upgrade-only continuation used working Hello0.2.0 and passed
three checks: alpha21→22 retains the explicit demo choice; installed module,
storage grant and counter survive the APK update; the configured shortcut selects
the public URL without typing and a signed Hello0.3 update retains the old data.
Both runs stopped their emulator. Crash buffers contain no Construct entry; the
first includes an unrelated emulator Bluetooth hardware-error abort. This is not
an exhaustive proof of absence of every runtime issue.

No broad camera/vision/measurement/contacts suites were rerun for this default-only
change. Those capabilities and native libraries are unchanged from alpha21;
physical ARM64 phone acceptance of this APK remains a separate user check.
