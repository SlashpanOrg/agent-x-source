#!/usr/bin/env bash
# scripts/release.sh — Bump version and push to release branch
# Usage: ./scripts/release.sh [patch|minor|major]
set -euo pipefail

BUMP_TYPE="${1:-patch}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$ROOT/packages/shared/src/constants/version.ts"
ROOT_PKG="$ROOT/package.json"

# Read current version
CURRENT=$(grep -oP "'\K[0-9]+\.[0-9]+\.[0-9]+" "$VERSION_FILE" 2>/dev/null || \
          grep -oE "'[0-9]+\.[0-9]+\.[0-9]+'" "$VERSION_FILE" | tr -d "'")

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP_TYPE" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  *) echo "Usage: $0 [patch|minor|major]"; exit 1 ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"

echo "Bumping version: $CURRENT → $NEW_VERSION ($BUMP_TYPE)"

# Update version constant
sed -i.bak "s/$CURRENT/$NEW_VERSION/" "$VERSION_FILE" && rm -f "$VERSION_FILE.bak"

# Update root package.json
sed -i.bak "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$ROOT_PKG" && rm -f "$ROOT_PKG.bak"

# Update homebrew formula
BREW_FILE="$ROOT/homebrew/agentx.rb"
if [ -f "$BREW_FILE" ]; then
  sed -i.bak "s/version \"$CURRENT\"/version \"$NEW_VERSION\"/" "$BREW_FILE" && rm -f "$BREW_FILE.bak"
fi

# Update CHANGELOG
CHANGELOG="$ROOT/CHANGELOG.md"
if [ -f "$CHANGELOG" ]; then
  DATE=$(date +%Y-%m-%d)
  sed -i.bak "s/^# Changelog/# Changelog\n\n## v$NEW_VERSION ($DATE)\n/" "$CHANGELOG" && rm -f "$CHANGELOG.bak"
fi

echo "Version updated to $NEW_VERSION"

# Commit, tag, and push
cd "$ROOT"
git add -A
git commit -m "chore: bump version to $NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
git push origin main
git push origin main:release
git push origin "v$NEW_VERSION"

echo "✅ Released v$NEW_VERSION — pushed to main + release + tag"
