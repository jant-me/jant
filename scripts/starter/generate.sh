#!/usr/bin/env bash
#
# Generate jant-starter template using create-jant CLI
# (for testing sync-starter workflow).
#
# Usage: scripts/starter/generate.sh

set -euo pipefail

pnpm --filter create-jant run prepack
PROJECT_ROOT=$(pwd)
rm -rf /tmp/my-site
cd /tmp && node "$PROJECT_ROOT/packages/create-jant/dist/index.js" my-site -y --no-install --no-git
rm -f /tmp/my-site/.dev.vars
echo ""
echo "Output: /tmp/my-site"
