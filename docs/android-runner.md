# Disposable Android runner

This is a real Android Emulator + ADB/uiautomator2 acceptance driver, not a simulated
browser test. Provision a dedicated Linux VM with KVM, two vCPUs, about 6 GiB RAM
and sufficient disk for SDK images and two snapshot AVDs (30 GiB or more recommended).
The reference guest uses 2 GiB; the emulator process is capped at 5 GiB. Keep ADB,
emulator console and gRPC local. No boot autostart and no personal phone data.

## Stage configuration

On the runner, from a source checkout:

```sh
python3 scripts/setup_runner.py --root /srv/construct-runner --expected-host YOUR_RUNNER_HOSTNAME --home-catalog https://modules.example.org/modules/index.json --test-catalog https://modules.example.org/module-tests/index.json
```

Choose a writable **new** absolute root. This writes scripts, an ignored JSON
configuration, result directory and an on-demand user service template; it does
not install an SDK, start a service or reset any device. SDK/AVD paths default
under that root; optional `--sdk` and `--avd-home` select existing disposable tools.
Paths cannot contain whitespace, quotes, backslash or percent. Catalog URLs must
be simple HTTPS index URLs without credentials or query parameters.

`runner.local.json` declares the exact hostname/root, SDK/AVD paths, catalogs and
`disposable:true`. Missing configuration, hostname/root mismatch or non-boolean
authorization fails closed. SERIAL is deliberately fixed to `emulator-5554`, not
configurable to a physical phone. Configuration is an operator safety guard, not
an authentication mechanism against another user controlling the same machine.
Run only one Construct emulator service at a time on port 5554.

## Provision tools and snapshots

1. Install Android command-line tools and accept licenses. Install `platform-tools`,
   `emulator` and `system-images;android-36;google_apis;x86_64`. Set `ANDROID_HOME`
   and `ANDROID_AVD_HOME` to the configured paths when invoking SDK tools.
2. Create a Python virtualenv at `RUNNER_ROOT/venv`, then install
   `RUNNER_ROOT/requirements.txt`. It pins the tested automation dependency set.
3. With `avdmanager`, create `construct-api36` and `construct-camera36` using that
   image and a phone profile such as `pixel_6`. Reference screenshots use a 720px
   wide portrait viewport. Adjust AVD resolution/density to the documented driver
   coordinates (720×1280, density240) before saving snapshots. Set `hw.keyboard=yes`
   and a 6 GiB sparse data partition (`disk.dataPartition.size=6G`).
4. First-boot each AVD manually with the SDK emulator, port5554, acceleration on,
   2048 MiB RAM, two cores, SwiftShader GPU, no window/audio and no snapshot load.
   For the normal AVD disable both cameras; for camera AVD use emulated rear camera
   and no front camera. Never attach a physical webcam to synthetic acceptance.
5. Wait for `sys.boot_completed=1`, run `RUNNER_ROOT/venv/bin/python -m uiautomator2 -s emulator-5554 init`, dismiss
   setup UI and ensure Construct is **absent**. Save `clean` for normal AVD and
   `camera-clean` for camera AVD using `adb -s emulator-5554 emu avd snapshot save NAME`.
   Stop after saving, restart with that snapshot and verify successful restoration
   and the absence of Construct. The suite requires both fresh startup-log evidence
   and an app-free package check; merely having a snapshot file is insufficient.
6. Copy the generated `construct-emulator-public.service` to your user's systemd
   unit directory and run `systemctl --user daemon-reload`. Do **not** enable it at
   boot. Its ExecStart must point to the chosen root. KVM and user-service access
   are operator provisioning requirements, not installed by the project.

### Example first-boot commands

With `ANDROID_HOME` and `ANDROID_AVD_HOME` set to the configured absolute paths,
and those SDK tools on PATH, the normal AVD creation/first boot is:

```sh
sdkmanager 'platform-tools' 'emulator' 'system-images;android-36;google_apis;x86_64'
avdmanager create avd --name construct-api36 --package 'system-images;android-36;google_apis;x86_64' --device pixel_6
# Apply the config.ini sizing above before first boot.
emulator -avd construct-api36 -port 5554 -accel on -memory 2048 -cores 2 -no-window -no-audio -no-boot-anim -gpu swiftshader -no-snapshot-load -no-snapshot-save -camera-back none -camera-front none
```

The emulator command stays running in that terminal. In another terminal use
`adb -s emulator-5554 shell getprop sys.boot_completed` to check readiness, initialize
the automation service, and verify `adb -s emulator-5554 shell pm list packages
dev.construct.runtime` returns no package. Save the snapshot with `adb -s
emulator-5554 emu avd snapshot save clean`, then stop with `adb -s emulator-5554 emu
kill`. Repeat for `construct-camera36`, using `-camera-back emulated` and snapshot
name `camera-clean`. Cold boot can take several minutes; do not save a setup/error
screen. The snapshot and dependency versions are part of your evidence.

## Additional Android platforms

See [Android 17 readiness](android17-readiness.md) for isolated API-level/service
profiles and the optional disk-saving shared synthetic-camera AVD. Existing
API-36 installations and snapshots remain the default.

## Run and review

Build an operator-profile pilot with your catalog shortcut/TLS configuration; see
[building](building.md). Serve the bootstrap home/test catalogs, including historical
checklist/tone versions and the test-only probe. Transfer the exact APK to the runner.

```sh
RUNNER_ROOT/runner.sh suite /absolute/path/candidate.apk APK_SHA256 --snake-sha256 SIGNED_SNAKE_ZIP_SHA256
```

Replace uppercase placeholders with your own paths and measured hashes. Use
`runner.sh suite --help` for module-specific scopes. Baseline includes checklist,
classified probes, renderer recovery, tone and consent. Focus/Snake/Contacts are
explicit hash-selected additions. Camera uses its separate synthetic snapshot and
`--camera-only --camera-sha256 HASH --camera-fresh-launches`; that last option
**excludes**, rather than passes, the documented direct-Reopen accessibility path.

For alpha 12 gallery acceptance, also pass `--camera-gallery-export` and
`--camera-version 0.1.2` with the exact matching launcher hash. This checks cancel,
MediaStore MIME/pending state, byte-for-byte equality with the private original,
and gallery-copy survival after private deletion. It does not verify a particular
vendor photo application's UI or cloud-backup behavior.

For selected-photo inference use `--camera-only --camera-vision-only`, the exact
launcher version/hash and the APK hash. First copy generated `dist/vision-fixtures`
images and `scripts/vision-assets.json` into the runner's `vision-fixtures/` folder.
This scope checks pinned public-domain/CC0 images, positive and negative results,
EXIF orientation, clearing and original-byte preservation with networking disabled
before first inference. It is not full camera/gallery or host acceptance. See
[photo analysis](photo-analysis.md) for provenance and model limits.

If the disposable Google APIs image presents a Digital Wellbeing ANR after
restoring an old snapshot, `--disable-digital-wellbeing` disables only
`com.google.android.apps.wellbeing` for that run and records the change. It does
not suppress Construct/system errors, change the stored snapshot, or touch a
physical device. Preserve the failed receipt that motivated this override.

For repeated module lifecycle observation use `--reliability-only`. It exercises
the bundled Hello counter through ten menu/Diagnostics/access/close cycles,
requiring real accessibility controls and preserved data without recovery taps.
The reference WebView 133 image has a reproducible stale-descendant problem;
`--webview-apk FILE --webview-sha256 HASH` supports an explicitly pinned Chromium
provider comparison on a disposable userdebug image. The provider is installed
after snapshot validation and its version/hash are recorded. This does not
rewrite the snapshot or change a phone. See [reliability evidence and provider
provenance](webview-reliability.md); do not conflate provider-specific results
with a fix for every WebView version or a physical screen-reader test.

`results/RUN_ID` contains receipts, child logs and screenshots. Review every child
and its scope: an earlier failed parent is never converted into success because
some children passed. Tests may insert synthetic contacts or temporarily use root
ADB on a disposable image for controlled probes. Camera restores non-root ADB.
The suite stops the emulator in `finally`; confirm its receipt and service state.
Stop/status are also available via `runner.sh stop` / `runner.sh status`.

Raw results can contain operator URLs and device metadata. Review/redact evidence
before sharing, never upload real contacts/photos or an entire private result tree.
The checked-in screenshots are synthetic reference-pilot images. Fresh source
verification is recorded separately in [public-release.md](public-release.md).
