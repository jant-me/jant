#!/usr/bin/env bash
#
# Create a new example from sites/demo via create-jant.
#
# Usage: scripts/example/create.sh <name>

set -euo pipefail

NAME="${1:?missing example name}"
DEST="examples/$NAME"

if [ -d "$DEST" ]; then
  echo "Already exists: $DEST"
  exit 1
fi

# Build create-jant if needed
if [ ! -f packages/create-jant/dist/index.js ]; then
  pnpm --filter create-jant run prepack
fi

# Scaffold via create-jant (processes @create-jant annotations)
cd /tmp
npm_config_user_agent="pnpm/10.0.0" node "$OLDPWD/packages/create-jant/dist/index.js" "example-$NAME" -y --no-install --no-git
cd -

mv "/tmp/example-$NAME" "$DEST"
pnpm install

echo ""
echo "Created: $DEST"
echo "Next: mise run example-run $NAME"
