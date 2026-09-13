#!/usr/bin/env bash
set -euo pipefail
runner_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$runner_root/runner.sh" emulator
