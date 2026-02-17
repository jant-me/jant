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

# Add mise shims to PATH so bare `node`/`pnpm` resolve to mise-managed
# versions (Node 24) instead of the system ones (Node 22).
SHIMS="$HOME/.local/share/mise/shims"
export PATH="$SHIMS:$PATH"
grep -qxF "export PATH=\"\$HOME/.local/share/mise/shims:\$PATH\"" "$HOME/.bashrc" 2>/dev/null \
  || echo 'export PATH="$HOME/.local/share/mise/shims:$PATH"' >> "$HOME/.bashrc"

# Trust the project mise.toml so mise doesn't error on untrusted config
mise trust 2>/dev/null || true

# Install Node.js and pnpm via mise
mise install

# Install dependencies
pnpm install
