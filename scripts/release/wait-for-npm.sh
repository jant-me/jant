#!/usr/bin/env bash
#
# Wait until the npm registry serves a version that was just published.
#
# Usage: scripts/release/wait-for-npm.sh <package> <version>
#
# `npm publish` returns before the registry serves the new version, and a large
# package can lag by minutes: @jant/core 0.7.0 appeared 11 minutes after
# changesets reported it published, and 1.0.1 six and a half minutes after.
# This polls the abbreviated packument with the Accept header `npm install`
# sends, so it waits on the document the install reads.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <package> <version>" >&2
  exit 2
fi

package=$1
version=$2
attempts=60
interval=30
url="https://registry.npmjs.org/${package/\//%2f}"

for attempt in $(seq 1 "$attempts"); do
  if curl -fsS -H 'Accept: application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*' "$url" |
    jq -e --arg v "$version" '.versions[$v]' >/dev/null; then
    echo "npm serves ${package}@${version}"
    exit 0
  fi
  echo "npm does not serve ${package}@${version} yet (attempt ${attempt}/${attempts}), retrying in ${interval}s"
  sleep "$interval"
done

echo "npm still does not serve ${package}@${version} after $((attempts * interval / 60)) minutes" >&2
exit 1
