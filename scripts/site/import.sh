#!/usr/bin/env bash
#
# Import sites/demo-source/canonical/site-export into a remote Jant instance.
#
# Usage: scripts/site/import.sh <url>
#
# Reads DEV_API_TOKEN from packages/core/.env.node.

set -euo pipefail

URL="${1:?missing url (e.g. https://demo.jant.me)}"

TOKEN=$(grep '^DEV_API_TOKEN=' packages/core/.env.node | cut -d'=' -f2-)
if [[ -z "$TOKEN" ]]; then
  echo "DEV_API_TOKEN not found in packages/core/.env.node"
  exit 1
fi

export JANT_API_TOKEN="$TOKEN"
# Trust the machine's own CA store (mkcert/Caddy roots) so a self-signed
# local target verifies normally. mise sets this too; repeated is harmless.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--use-system-ca"
exec ./packages/core/bin/jant.js site import "$URL" --path sites/demo-source/canonical/site-export
