# Building and local verification

## Prerequisites

- JDK 17; Android SDK platform 35 and build-tools 35.0.0.
- Android NDK 27.2.12479018 and SDK CMake 3.22.1 (install with `sdkmanager
  'ndk;27.2.12479018' 'cmake;3.22.1'`). Native builds use one compiler job at a time.
- Python 3.10+ and `cryptography` 41+ in a virtual environment.
- Node.js 20+ for deterministic module tests.
- Linux is the reference build/runner environment. The Android minimum is API 28;
  the reference emulator runs API 36. The checksum-pinned Gradle 8.11.1 wrapper
  downloads Gradle; builds also download Maven dependencies and Android components.

Set `JAVA_HOME` to your JDK and `ANDROID_HOME` to your SDK. Alternatively put
`sdk.dir=/absolute/path/to/android-sdk` in the ignored `local.properties` file.
Accept Android SDK licenses when provisioning your SDK. The checked-in GitHub
workflow explicitly provisions its SDK and accepts the SDK licenses for that CI
environment; review that workflow before enabling it on your own fork.

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

### Architecture-specific APKs and measurement engine

The build produces separate `app-arm64-v8a-pilot.apk` (modern ARM64 phones) and
`app-x86_64-pilot.apk` (reference emulator) under `core/app/build/outputs/apk/pilot`.
They are standalone APKs, not a set of splits requiring a special installer. Use
the matching architecture; there is no universal or 32-bit APK in this configuration.
Both carry the same application ID/version/signing identity. A matching signed
ARM64 APK can update an existing universal installation without removing user data.

`prepare_fixtures.py` also runs `prepare_opencv.py`, which fetches checksum-pinned
OpenCV 4.12.0 source into ignored `dist/native-source`. To preserve existing operator
fixture/signing assets, run just `python3 scripts/prepare_opencv.py` when preparing
this dependency. Do not regenerate operator fixture keys as part of an APK update.

CMake builds upstream `objdetect` and its required core/imgproc/calib3d/features2d/
flann dependencies as static libraries. The linker retains only code reachable from
the narrow measurement JNI bridge. The full Java wrapper, DNN, codecs, OpenCV Manager
and unused architectures are not shipped. The algorithm/dictionary/subpixel settings
remain OpenCV 4.12.0's. See [provenance](../third_party/README.md).

`scripts/check_apk_size.py APK --abi arm64-v8a --max-mb BUDGET` reports actual
size/hash/native inventory and checks architecture, 16 KB ELF load alignment,
the absence of full OpenCV JNI and unchanged bundled models. Run Android SDK
`zipalign -c -P 16 -v 4 APK` and `apksigner verify --verbose --print-certs APK` too.
Emulator receipts cover the x86-64 APK, not execution of ARM64 code: phone acceptance
remains a separate, explicitly reported check.

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
