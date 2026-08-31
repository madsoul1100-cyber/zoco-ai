#!/usr/bin/env bash
# Free disk on a deploy instance. Safe: keeps app code, .env, and runtime data.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Before"
df -h / | tail -1
du -sh "$ROOT" 2>/dev/null || true

echo "==> npm / yarn / pnpm caches"
npm cache clean --force 2>/dev/null || true
rm -rf "${HOME}/.npm/_cacache" "${HOME}/.npm/_logs" 2>/dev/null || true
rm -rf "${HOME}/.cache/yarn" "${HOME}/.pnpm-store" 2>/dev/null || true

echo "==> Project build / tool caches"
find "$ROOT" -type d \( -name '.cache' -o -name '.vite' -o -name '.turbo' -o -name 'coverage' \) \
  -not -path '*/node_modules/*' -prune -exec rm -rf {} + 2>/dev/null || true
find "$ROOT" -type f \( -name '*.log' -o -name 'npm-debug.log*' -o -name 'yarn-error.log*' \) \
  -not -path '*/node_modules/*' -delete 2>/dev/null || true

echo "==> Regenerable TTS / recording temp (keeps agents, contacts, rules)"
rm -rf "$ROOT/data/tts"/* 2>/dev/null || true
find "$ROOT/data/recordings" -type f -name '*.tmp' -delete 2>/dev/null || true

echo "==> Optional: skip heavy LiveKit worker deps if present (saves ~500MB)"
if [[ "${REMOVE_REALTIME:-0}" == "1" ]]; then
  rm -rf "$ROOT/realtime/node_modules" "$ROOT/realtime/dist"
  echo "    removed realtime/node_modules"
fi

echo "==> OS / docker leftover (needs sudo on some hosts)"
sudo journalctl --vacuum-time=2d 2>/dev/null || true
sudo apt-get clean 2>/dev/null || true
sudo yum clean all 2>/dev/null || true
docker system prune -f 2>/dev/null || true

echo "==> After"
df -h / | tail -1
du -sh "$ROOT" 2>/dev/null || true
echo "Done. Re-install only backend+frontend if you wiped caches before a fresh deploy."
