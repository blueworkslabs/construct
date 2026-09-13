#!/usr/bin/env bash
set -euo pipefail
runner_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
runner_python="$runner_root/venv/bin/python"
[[ -x "$runner_python" ]] || runner_python=python3
exec "$runner_python" "$runner_root/control.py" "$@"
