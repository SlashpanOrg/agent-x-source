#!/usr/bin/env bash
set -euo pipefail

# Agent-X Uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agentx-releases/main/uninstall.sh | bash

INSTALL_DIR="${AGENTX_INSTALL_DIR:-$HOME/.agentx}"
BIN_DIR="${AGENTX_BIN_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agentx"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/agentx"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/agentx"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$1"; }

# --- Removal ---

remove_installation() {
  if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    ok "Removed installation: $INSTALL_DIR"
  else
    info "No installation found at $INSTALL_DIR (skipped)"
  fi
}

remove_binary() {
  if [ -e "$BIN_DIR/agentx" ]; then
    rm -f "$BIN_DIR/agentx"
    ok "Removed binary: $BIN_DIR/agentx"
  else
    info "No binary found at $BIN_DIR/agentx (skipped)"
  fi
}

remove_global_package() {
  # Remove if installed via npm/pnpm globally
  if command -v npm >/dev/null 2>&1; then
    npm uninstall -g @agentx/cli >/dev/null 2>&1 && ok "Removed global npm package" || true
  fi
  if command -v pnpm >/dev/null 2>&1; then
    pnpm remove -g @agentx/cli >/dev/null 2>&1 && ok "Removed global pnpm package" || true
  fi
}

remove_data() {
  local removed=false

  if [ -d "$CONFIG_DIR" ]; then
    rm -rf "$CONFIG_DIR"
    ok "Removed config: $CONFIG_DIR"
    removed=true
  fi

  if [ -d "$DATA_DIR" ]; then
    rm -rf "$DATA_DIR"
    ok "Removed data: $DATA_DIR"
    removed=true
  fi

  if [ -d "$CACHE_DIR" ]; then
    rm -rf "$CACHE_DIR"
    ok "Removed cache: $CACHE_DIR"
    removed=true
  fi

  if [ "$removed" = false ]; then
    info "No user data found (skipped)"
  fi
}

clean_path_entries() {
  # Attempt to remove PATH entries from shell configs
  local shell_files=("$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile")

  for rc in "${shell_files[@]}"; do
    if [ -f "$rc" ] && grep -q "# Agent-X" "$rc" 2>/dev/null; then
      # Remove the Agent-X PATH block (comment + export line)
      sed -i.bak '/# Agent-X/d' "$rc"
      sed -i.bak "\|${BIN_DIR}|d" "$rc"
      rm -f "${rc}.bak"
      ok "Cleaned PATH entry from $rc"
    fi
  done
}

# --- Main ---

main() {
  echo ""
  echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
  echo -e "${CYAN}  ║        Agent-X Uninstaller            ║${NC}"
  echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
  echo ""

  info "Removing Agent-X..."
  echo ""

  remove_binary
  remove_installation
  remove_global_package
  echo ""

  # Ask about user data
  if [ -d "$CONFIG_DIR" ] || [ -d "$DATA_DIR" ] || [ -d "$CACHE_DIR" ]; then
    echo -e "  ${YELLOW}User data found:${NC}"
    [ -d "$CONFIG_DIR" ] && echo "    • Config:  $CONFIG_DIR"
    [ -d "$DATA_DIR" ]   && echo "    • Data:    $DATA_DIR"
    [ -d "$CACHE_DIR" ]  && echo "    • Cache:   $CACHE_DIR"
    echo ""

    # When piped via curl, default to removing data
    if [ -t 0 ]; then
      printf "  Remove user data (sessions, config, memories)? [y/N] "
      read -r answer
      if [[ "$answer" =~ ^[Yy] ]]; then
        remove_data
      else
        info "User data preserved"
      fi
    else
      warn "Running non-interactively — preserving user data"
      info "To also remove data, run: rm -rf $CONFIG_DIR $DATA_DIR $CACHE_DIR"
    fi
  fi

  echo ""
  clean_path_entries

  echo ""
  echo -e "${GREEN}  ╔═══════════════════════════════════════╗${NC}"
  echo -e "${GREEN}  ║   Agent-X uninstalled successfully    ║${NC}"
  echo -e "${GREEN}  ╚═══════════════════════════════════════╝${NC}"
  echo ""
  echo "  Open a new terminal for PATH changes to take effect."
  echo ""
}

main "$@"
