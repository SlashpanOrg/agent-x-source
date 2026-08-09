#!/usr/bin/env bash
# Fast install: build updated code, sync into unpacked .app, install to /Applications.
#
# Default (fast): skip node_modules wipe, incremental builds, sync into existing .app
#   when packages/desktop/release/mac-arm64/Agent-X.app exists.
#
# Flags / env:
#   --repack / CLEAN_INSTALL_REPACK=1   Full electron-builder repack (slow)
#   --full-deps / CLEAN_INSTALL_FULL_DEPS=1   rm node_modules + pnpm install (slow)
#   --skip-cache   Skip Electron cache wipe
#
# For a full wipe (data, PG, node_modules prune): use ./clean-slate.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$ROOT_DIR/packages/desktop"
APP_PATH="$DESKTOP_DIR/release/mac-arm64/Agent-X.app"
APP_RES="$APP_PATH/Contents/Resources"

REPACK=0
FULL_DEPS=0
SKIP_CACHE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repack) REPACK=1 ;;
    --full-deps) FULL_DEPS=1 ;;
    --skip-cache) SKIP_CACHE=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (try --help)" >&2
      exit 1
      ;;
  esac
  shift
done

if [ "${CLEAN_INSTALL_REPACK:-0}" = "1" ]; then REPACK=1; fi
if [ "${CLEAN_INSTALL_FULL_DEPS:-0}" = "1" ]; then FULL_DEPS=1; fi
if [ "${CLEAN_INSTALL_SKIP_CACHE:-0}" = "1" ]; then SKIP_CACHE=1; fi

echo "=== Clean Install: Agent-X ==="

# 1. Kill running app / server daemon
echo ">>> Killing Agent-X if running..."
pkill -9 -f "Agent-X" 2>/dev/null || true
pkill -9 -f "@agentx/server" 2>/dev/null || true
pkill -9 -f "packages/server/dist" 2>/dev/null || true
pkill -9 -f "$HOME/.agentx/index.js" 2>/dev/null || true
sleep 1

# 2. Remove from /Applications (replaced after build)
echo ">>> Removing /Applications/Agent-X.app..."
sudo rm -rf /Applications/Agent-X.app 2>/dev/null || true

# 3. Clear Electron cache only (preserve config, data, databases)
if [ "$SKIP_CACHE" -eq 0 ]; then
  echo ">>> Clearing Electron cache..."
  rm -rf "$HOME/.cache/agentx"
  rm -rf "$HOME/Library/Application Support/@agentx/desktop/Cache"
  rm -rf "$HOME/Library/Application Support/@agentx/desktop/Code Cache"
  rm -rf "$HOME/Library/Application Support/@agentx/desktop/DawnGraphiteCache"
  rm -rf "$HOME/Library/Application Support/@agentx/desktop/DawnWebGPUCache"
  rm -rf "$HOME/Library/Application Support/@agentx/desktop/GPUCache"
  rm -rf "$HOME/Library/Application Support/@agentx/desktop/Service Worker"
else
  echo ">>> Skipping cache wipe (--skip-cache)"
fi

# 4. Dependencies — fast by default (no node_modules wipe)
cd "$ROOT_DIR"
if [ "$FULL_DEPS" -eq 1 ]; then
  echo ">>> Reinstalling dependencies (full: rm node_modules)..."
  rm -rf node_modules packages/*/node_modules
  pnpm install --no-frozen-lockfile
else
  if [ ! -d node_modules ]; then
    echo ">>> Installing dependencies (node_modules missing)..."
    pnpm install
  else
    echo ">>> Verifying dependencies (keeping existing node_modules)..."
    pnpm install
  fi
fi

# 5. Decide fast sync vs full repack (requires intact app.asar — Electron main lives there)
USE_SYNC=0
if [ "$REPACK" -eq 0 ] && [ -d "$APP_RES" ] && [ -f "$APP_RES/app.asar" ]; then
  USE_SYNC=1
elif [ "$REPACK" -eq 0 ] && [ -d "$APP_RES" ] && [ ! -f "$APP_RES/app.asar" ]; then
  echo ">>> Unpacked .app exists but app.asar is missing — forcing full repack"
fi

if [ "$USE_SYNC" -eq 1 ]; then
  echo ">>> Fast path: sync web-api / web-ui only (skip electron-builder)"
  echo "    Use --repack for desktop main/preload or when app.asar is missing."
else
  echo ">>> Full repack path (no unpacked .app yet, or --repack requested)"
  echo ">>> Cleaning desktop release artifacts..."
  cd "$DESKTOP_DIR"
  rm -rf dist release
  cd "$ROOT_DIR"
  rm -rf packages/server/release packages/server/.pack-staging 2>/dev/null || true
  # Keep runtime/python, ffmpeg, and web-api Playwright cache across rebuilds
fi

# 6. Build packages (incremental — dist folders are not wiped on fast path)
echo ">>> Building shared, engine, runtime, web-api, and web-ui..."
cd "$ROOT_DIR"
pnpm --filter @agentx/shared run build
pnpm --filter @agentx/engine run build
pnpm --filter @agentx/runtime run build
pnpm --filter @agentx/web-api run build
pnpm --filter @agentx/web-ui run build

if [ "$USE_SYNC" -eq 1 ]; then
  echo ">>> Syncing web-api / web-ui into unpacked .app..."
  cd "$DESKTOP_DIR"
  node scripts/patch-unpacked-app.mjs "$APP_PATH"
else
  # 7. pgvector — skip when already built
  echo ">>> Ensuring PostgreSQL extension (pgvector)..."
  pnpm --filter @agentx/runtime run setup:extensions:if-needed

  # 8. Full desktop pack
  echo ">>> Building desktop app (electron-builder)..."
  cd "$DESKTOP_DIR"
  node scripts/materialize-pack-deps.mjs
  pnpm run build
  pnpm --filter @agentx/runtime run setup:voice-bundled
  pnpm exec electron-builder --mac --dir
fi

# 9. Install to /Applications
echo ">>> Installing to /Applications (password prompt may appear)..."
CURRENT_USER=$(whoami)
osascript -e "do shell script \"rm -rf /Applications/Agent-X.app && ditto '$APP_PATH' /Applications/Agent-X.app && chown -R '$CURRENT_USER:staff' /Applications/Agent-X.app && xattr -rd com.apple.quarantine /Applications/Agent-X.app 2>/dev/null || true\" with administrator privileges"

# 10. Launch
echo ">>> Launching Agent-X..."
open /Applications/Agent-X.app

echo "=== Clean install done! ==="
if [ "$USE_SYNC" -eq 1 ]; then
  echo "Tip: used fast sync. For electron/native/voice asset changes, run: ./clean-install.sh --repack"
fi
