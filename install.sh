#!/usr/bin/env bash
set -euo pipefail

# Agent-X Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/install.sh | bash

REPO="SlashpanOrg/agent-x"
INSTALL_DIR="${AGENTX_INSTALL_DIR:-$HOME/.agentx}"
BIN_DIR="${AGENTX_BIN_DIR:-$HOME/.local/bin}"
MIN_NODE_VERSION=20

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$1"; }
die()   { printf "${RED}✗${NC} %s\n" "$1" >&2; exit 1; }

# --- Pre-requisite checks ---

check_command() {
  command -v "$1" >/dev/null 2>&1
}

check_node() {
  if ! check_command node; then
    die "Node.js is not installed. Install Node.js >= $MIN_NODE_VERSION: https://nodejs.org"
  fi
  local node_major
  node_major=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$node_major" -lt "$MIN_NODE_VERSION" ]; then
    die "Node.js $MIN_NODE_VERSION+ required (found $(node -v)). Upgrade: https://nodejs.org"
  fi
  ok "Node.js $(node -v)"
}

check_git() {
  if ! check_command git; then
    die "Git is not installed. Install git first."
  fi
  ok "Git $(git --version | awk '{print $3}')"
}

install_pnpm() {
  if check_command pnpm; then
    local pnpm_major
    pnpm_major=$(pnpm -v | cut -d. -f1)
    if [ "$pnpm_major" -ge 9 ]; then
      ok "pnpm $(pnpm -v)"
      return
    fi
    warn "pnpm 9+ required (found $(pnpm -v)). Upgrading..."
  else
    info "Installing pnpm..."
  fi

  if check_command corepack; then
    corepack enable >/dev/null 2>&1 && corepack prepare pnpm@latest --activate >/dev/null 2>&1
  else
    npm install -g pnpm@latest >/dev/null 2>&1
  fi

  if ! check_command pnpm; then
    die "Failed to install pnpm. Try manually: npm install -g pnpm"
  fi
  ok "pnpm $(pnpm -v)"
}

# --- Clean existing installation ---

clean_existing() {
  if [ -d "$INSTALL_DIR" ]; then
    warn "Existing installation found at $INSTALL_DIR"
    info "Removing to avoid conflicts..."
    rm -rf "$INSTALL_DIR"
    ok "Removed $INSTALL_DIR"
  fi

  if [ -d "$HOME/.agentx" ] && [ "$INSTALL_DIR" != "$HOME/.agentx" ]; then
    warn "Found legacy install at ~/.agentx"
    rm -rf "$HOME/.agentx"
    ok "Removed ~/.agentx"
  fi

  # Remove stale binary/symlink
  if [ -e "$BIN_DIR/agentx" ]; then
    rm -f "$BIN_DIR/agentx"
    ok "Removed old binary at $BIN_DIR/agentx"
  fi

  # Clean global npm/pnpm installs of agentx if present
  if check_command agentx; then
    local existing_path
    existing_path=$(command -v agentx)
    if [[ "$existing_path" == *"node_modules"* ]] || [[ "$existing_path" == *"npm"* ]]; then
      warn "Found global npm install of agentx at $existing_path"
      npm uninstall -g @agentx/cli >/dev/null 2>&1 || true
      pnpm remove -g @agentx/cli >/dev/null 2>&1 || true
      ok "Removed global npm package"
    fi
  fi
}

# --- Install ---

clone_repo() {
  info "Cloning Agent-X from GitHub..."
  git clone --depth 1 "https://github.com/${REPO}.git" "$INSTALL_DIR" 2>/dev/null
  ok "Cloned to $INSTALL_DIR"
}

install_deps() {
  info "Installing dependencies..."
  cd "$INSTALL_DIR"
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  ok "Dependencies installed"
}

build_project() {
  info "Building Agent-X..."
  cd "$INSTALL_DIR"
  pnpm run build >/dev/null 2>&1
  ok "Build complete"
}

create_binary() {
  mkdir -p "$BIN_DIR"

  cat > "$BIN_DIR/agentx" << 'EOF'
#!/usr/bin/env bash
AGENTX_ROOT="${AGENTX_INSTALL_DIR:-$HOME/.agentx}"
exec node "$AGENTX_ROOT/packages/cli/dist/index.js" "$@"
EOF
  chmod +x "$BIN_DIR/agentx"
  ok "Executable created: $BIN_DIR/agentx"
}

ensure_path() {
  if [[ ":$PATH:" == *":$BIN_DIR:"* ]]; then
    return
  fi

  warn "$BIN_DIR is not in your PATH"
  local shell_rc=""
  case "$(basename "${SHELL:-bash}")" in
    zsh)  shell_rc="$HOME/.zshrc" ;;
    bash) shell_rc="$HOME/.bashrc" ;;
    fish) shell_rc="$HOME/.config/fish/config.fish" ;;
  esac

  if [ -n "$shell_rc" ] && [ -f "$shell_rc" ]; then
    printf '\n# Agent-X\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$shell_rc"
    info "Added $BIN_DIR to PATH in $shell_rc"
    info "Run: source $shell_rc (or open a new terminal)"
  else
    echo ""
    echo "  Add this to your shell profile:"
    echo "    export PATH=\"$BIN_DIR:\$PATH\""
  fi
}

# --- Main ---

main() {
  echo ""
  echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
  echo -e "${CYAN}  ║         Agent-X Installer             ║${NC}"
  echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
  echo ""

  info "Checking prerequisites..."
  echo ""
  check_node
  check_git
  install_pnpm
  echo ""

  clean_existing
  echo ""

  clone_repo
  install_deps
  build_project
  create_binary
  ensure_path

  echo ""
  echo -e "${GREEN}  ╔═══════════════════════════════════════╗${NC}"
  echo -e "${GREEN}  ║   Agent-X installed successfully! 🚀  ║${NC}"
  echo -e "${GREEN}  ╚═══════════════════════════════════════╝${NC}"
  echo ""
  echo "  Get started:   agentx"
  echo "  Help:          agentx --help"
  echo "  Uninstall:     curl -fsSL https://raw.githubusercontent.com/${REPO}/main/uninstall.sh | bash"
  echo ""
}

main "$@"
