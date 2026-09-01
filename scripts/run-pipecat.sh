#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if command -v uv >/dev/null 2>&1; then
  uv sync --directory pipecat
  exec uv run --directory pipecat bot.py
fi

python="${PYTHON:-python3}"
venv="$root/pipecat/.venv"
if [ ! -x "$venv/bin/python" ]; then
  echo "uv not found; creating pipecat/.venv with $python"
  "$python" -m venv "$venv"
  "$venv/bin/pip" install -U pip
  "$venv/bin/pip" install -r "$root/pipecat/requirements.txt"
fi

exec "$venv/bin/python" "$root/pipecat/bot.py"
