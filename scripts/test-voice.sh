#!/usr/bin/env bash
# Automated voice regression suite (no live mic / API keys required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0

echo "== LiveKit / realtime voice scenarios =="
if ! (cd "$ROOT/realtime" && node --test test/*.test.js); then
  FAIL=1
fi

echo ""
echo "== Pipecat language / backchannel scenarios =="
if [[ -x "$ROOT/pipecat/.venv/bin/python" ]]; then
  PY="$ROOT/pipecat/.venv/bin/python"
else
  PY="${PYTHON:-python3}"
fi
if ! (cd "$ROOT/pipecat" && "$PY" -m unittest test_language_cases.py -v); then
  FAIL=1
fi

echo ""
echo "== Frontend voice helpers =="
if [[ -f "$ROOT/frontend/test/voice.test.js" ]]; then
  if ! (cd "$ROOT/frontend" && node --test test/voice.test.js); then
    FAIL=1
  fi
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "All voice regression tests passed."
  exit 0
fi
echo "Voice regression tests FAILED."
exit 1
