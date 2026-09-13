#!/usr/bin/env bash
# Idempotent Cloud Agent setup for Construct.
# Provisions the reference toolchain (JDK 17, Android SDK 35, Python cryptography),
# generates the signed synthetic fixtures the JVM tests depend on, and points
# Gradle at the right JDK/SDK without mutating shell profiles.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

JAVA_17_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
ANDROID_SDK="${ANDROID_SDK_ROOT:-$HOME/android-sdk}"
CMDLINE_TOOLS_VERSION="11076708"

log() { printf '\n=== %s ===\n' "$1"; }

log "System packages (JDK 17, venv, unzip)"
if [ ! -x "$JAVA_17_HOME/bin/javac" ] || ! command -v unzip >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    openjdk-17-jdk-headless python3-venv python3-pip unzip curl
fi

log "Android SDK (platform-tools, platforms;android-35, build-tools;35.0.0)"
export ANDROID_HOME="$ANDROID_SDK"
export ANDROID_SDK_ROOT="$ANDROID_SDK"
SDKMANAGER="$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$SDKMANAGER" ]; then
  mkdir -p "$ANDROID_SDK/cmdline-tools"
  tmp_zip="$(mktemp)"
  curl -fsSL -o "$tmp_zip" \
    "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip"
  rm -rf "$ANDROID_SDK/cmdline-tools/latest" "$ANDROID_SDK/cmdline-tools/tmp-extract"
  unzip -q -o "$tmp_zip" -d "$ANDROID_SDK/cmdline-tools/tmp-extract"
  mv "$ANDROID_SDK/cmdline-tools/tmp-extract/cmdline-tools" "$ANDROID_SDK/cmdline-tools/latest"
  rm -rf "$ANDROID_SDK/cmdline-tools/tmp-extract" "$tmp_zip"
fi
# `yes` dies with SIGPIPE once sdkmanager stops reading; drop pipefail here so
# that expected signal does not abort the script, while sdkmanager's own exit
# status still propagates.
( set +o pipefail; yes | JAVA_HOME="$JAVA_17_HOME" "$SDKMANAGER" --sdk_root="$ANDROID_SDK" --licenses >/dev/null )
JAVA_HOME="$JAVA_17_HOME" "$SDKMANAGER" --sdk_root="$ANDROID_SDK" \
  "platform-tools" "platforms;android-35" "build-tools;35.0.0" >/dev/null

log "Point Gradle at JDK 17 and the Android SDK"
mkdir -p "$HOME/.gradle"
printf 'org.gradle.java.home=%s\n' "$JAVA_17_HOME" > "$HOME/.gradle/gradle.properties"
printf 'sdk.dir=%s\n' "$ANDROID_SDK" > "$REPO_ROOT/local.properties"

log "Python signing dependency (cryptography)"
# Mirror CI: install cryptography for the system interpreter so scripts run
# without activating a virtualenv. Use the system python explicitly so an
# already-active venv in the calling shell cannot redirect the install.
SYS_PYTHON="$(command -v /usr/bin/python3 || command -v python3)"
"$SYS_PYTHON" -m pip install --user --upgrade 'cryptography>=41' \
  || "$SYS_PYTHON" -m pip install --user --break-system-packages --upgrade 'cryptography>=41'

log "Generate signed synthetic fixtures (required by JVM unit tests)"
"$SYS_PYTHON" scripts/prepare_fixtures.py

log "Setup complete"
