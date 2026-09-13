# Building and local verification

## Prerequisites

- JDK 17; Android SDK platform 35 and build-tools 35.0.0.
- Python 3.10+ and `cryptography` 41+ in a virtual environment.
- Node.js 20+ for deterministic module tests.
- Linux is the reference build/runner environment. The Android minimum is API 28;
  the reference emulator runs API 36. The checksum-pinned Gradle 8.11.1 wrapper
  downloads Gradle; builds also download Maven dependencies and Android components.

Set `JAVA_HOME` to your JDK and `ANDROID_HOME` to your SDK. Alternatively put
`sdk.dir=/absolute/path/to/android-sdk` in the ignored `local.properties` file.
Accept Android SDK licenses yourself when provisioning the SDK.

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install 'cryptography>=41'
python3 scripts/prepare_fixtures.py
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 -O -m unittest discover -s scripts/android-runner -p 'test_*.py'
python3 -m unittest discover -s server -p 'test_*.py'
node scripts/test_snake.cjs
node scripts/test_focus.cjs
node scripts/test_contacts.cjs
node scripts/test_camera.cjs
./gradlew --no-daemon :core:app:testDebugUnitTest :core:app:lintDebug :core:app:assembleDebug --max-workers=1
```

The fixture bootstrap generates signed Hello assets, the pinned publisher public
key, JVM fixture catalogs and current example home/test catalogs. Its historical
version labels are synthetic **current-source fixtures**, not reproductions of old
private releases. Output defaults to ignored `dist/fixtures`; JVM tests use that path.
If you modify a previously generated version, use a fresh checkout/output and bump
published versions rather than bypassing immutable-package checks.

The publisher private key stays outside the checkout in
`~/.local/share/construct-signing`. Set `CONSTRUCT_SIGNING_DIR` to a dedicated
absolute directory outside the checkout to create an independent development
identity. Never commit or upload that directory. The bootstrap refuses an in-repo
signing directory. Preserve your key privately if you need subsequent compatible
module updates.

**Two different identities:** Android APK signing controls APK updates; the module
publisher key verifies downloaded ZIPs. Build your APK and packages with the same
publisher identity. Your generated modules will not verify against another
operator's APK. Debug and pilot builds are development-signed, not public release
signing. `assemblePilot` creates the optimized, non-debuggable pilot variant.
A separately signed APK with the same application ID cannot update an existing
installation signed by someone else; use a disposable emulator for reproduction.

## Optional operator profile

```sh
python3 scripts/configure_host.py --registry https://modules.example.org/modules/index.json
```

For a private CA, add `--ca-cert /absolute/path/to/public-ca.crt`. Only a public CA
certificate is accepted, never its private key. The generated ignored
`core/app/src/deployment/res` overrides the otherwise safe resources for debug,
pilot and release variants. It adds a **Use configured registry** shortcut and,
when requested, trusts that CA only for the exact registry hostname. Rebuild after
changing a profile. Use a fresh checkout for a default/system-trust build.

Review generated configuration before building; do not distribute a lab-specific
APK as a universal installer. No release binary or shared signing identity is
provided in the initial public source release.
