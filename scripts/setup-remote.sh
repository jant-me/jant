#!/bin/bash
# scripts/setup-remote.sh — Bootstrap tooling for Claude Code remote sessions
set -euo pipefail

if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

# Ensure $HOME/.local/bin is in PATH for this script and all future shells
export PATH="$HOME/.local/bin:$PATH"
grep -qxF 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc" 2>/dev/null \
  || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"

# Install mise (skip if already installed)
if ! command -v mise &>/dev/null; then
  # mise.run and mise.jdx.dev both work; the raw GitHub URL does NOT exist
  curl -fsSL https://mise.jdx.dev/install.sh | sh
fi

# Install entire (skip if already installed)
if ! command -v entire &>/dev/null; then
  curl -fsSL https://raw.githubusercontent.com/entireio/cli/main/scripts/install.sh | bash
fi

# Trust the project mise.toml so mise doesn't error on untrusted config
mise trust 2>/dev/null || true

# Install Node.js and pnpm via mise
mise install

# Use mise-managed tools (Node 24 + pnpm) for dependency installation.
# Running bare `pnpm install` would pick up the system Node (v22) and fail
# because the project requires Node >=24.
mise exec -- pnpm install
