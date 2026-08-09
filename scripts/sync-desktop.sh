#!/usr/bin/env bash
# Hot-reload web-api / web-ui into the unpacked dev .app (no electron rebuild).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="$ROOT_DIR/packages/desktop/release/mac-arm64/Agent-X.app"

if [[ ! -d "$APP_PATH/Contents/Resources" ]]; then
  echo "Unpacked app not found. Run ./scripts/dev-desktop.sh or ./clean-install.sh --repack first." >&2
  exit 1
fi

echo ">>> Building engine, web-api, web-ui..."
cd "$ROOT_DIR"
pnpm --filter @agentx/engine run build
pnpm --filter @agentx/web-api run build
pnpm --filter @agentx/web-ui run build

echo ">>> Syncing into unpacked .app"
node "$ROOT_DIR/packages/desktop/scripts/patch-unpacked-app.mjs" "$APP_PATH"

echo ">>> Reload the Agent-X window (Cmd+R) or restart the app to pick up changes."
echo "    For desktop main/preload changes, run ./clean-install.sh --repack"
