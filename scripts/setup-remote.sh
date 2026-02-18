#!/bin/bash
# scripts/setup-remote.sh — Bootstrap tooling for Claude Code remote sessions
set -euo pipefail

if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

# Install mise (skip if already installed)
if ! command -v mise &>/dev/null; then
  curl -fsSL https://mise.jdx.dev/install.sh | sh
fi

# Install entire (skip if already installed)
if ! command -v entire &>/dev/null; then
  curl -fsSL https://entire.io/install.sh | bash
fi

# Add mise shims to PATH for this script (non-interactive, so `mise activate`
# won't work here). This makes bare `node`/`pnpm` resolve to mise-managed
# versions (Node 24) instead of the system ones (Node 22).
export PATH="$HOME/.local/share/mise/shims:$PATH"

# For interactive shells, activate mise properly in .bashrc
grep -qF 'mise activate bash' "$HOME/.bashrc" 2>/dev/null \
  || cat >> "$HOME/.bashrc" <<'BASHRC'

# mise
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate bash)"
fi
BASHRC

# Trust the project mise.toml so mise doesn't error on untrusted config
mise trust 2>/dev/null || true

# Install Node.js and pnpm via mise
mise install

# Install dependencies
pnpm install

# Set up local database with seed data
mise run db-seed

# Set dev login credentials (demo@jant.me / testtest)
mise run dev-password testtest
