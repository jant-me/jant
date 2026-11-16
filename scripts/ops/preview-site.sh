#!/usr/bin/env bash
#
# Deploy a pushed branch as a plain single-site Jant on the preview server.
#
# Usage: scripts/ops/preview-site.sh [branch]
#
# Without a branch it previews the current one, which must match origin. It
# dispatches deploy-studio.yml with service=jant-site on the branch, follows
# that run and the tonormal/build run it starts, then waits until the site
# serves the branch's commit from a container started after the dispatch.
# CI is not waited for.
#
# The site is studio's external-apps/jant-site: single-site mode, SQLite and
# media in a tmpfs, seeded from sites/demo-source/canonical/snapshot on every
# start. Each deploy is a fresh database, so a branch's migrations never touch
# a shared one.

set -euo pipefail

REPO="jant-me/jant"
BUILD_REPO="tonormal/build"
SERVICE="jant-site"
# Created by the seed in studio's external-apps/jant-site/.env.tpl.
OWNER_EMAIL="owner@example.com"
PASSWORD_PARAM="/studio-dev/JANT_SITE_OWNER_PASSWORD"

die() {
  echo "error: $*" >&2
  exit 1
}

for tool in git gh jq curl; do
  command -v "$tool" >/dev/null || die "$tool is not installed."
done

branch="${1:-}"
current=false
if [ -z "$branch" ]; then
  branch="$(git symbolic-ref --quiet --short HEAD)" ||
    die "HEAD is detached. Check out a branch, or name one: mise run preview-site <branch>"
  current=true
fi

# The build deploys main to production, and jant-site has no production.
[ "$branch" != "main" ] || die "main deploys to production. Preview another branch."

remote_sha="$(git ls-remote --exit-code origin "refs/heads/$branch" | cut -f1)" ||
  die "origin has no branch $branch. Push it first: git push -u origin $branch"

if [ "$current" = true ]; then
  local_sha="$(git rev-parse HEAD)"
  if [ "$local_sha" != "$remote_sha" ]; then
    die "HEAD is ${local_sha:0:12} but origin/$branch is ${remote_sha:0:12}. Push or pull until they match."
  fi
  if [ -n "$(git status --porcelain)" ]; then
    echo "note: uncommitted changes are not part of the preview." >&2
  fi
fi

# The host the build gives this branch (studio scripts/build-lib.sh,
# detect_environment): every character outside [a-zA-Z0-9-] becomes "-", then
# lowercase, first 30 characters. The preview branch itself has no suffix.
clean="$(printf '%s' "$branch" | sed 's/[^a-zA-Z0-9-]/-/g' | tr '[:upper:]' '[:lower:]' | cut -c1-30)"
if [ "$branch" = "preview" ]; then
  url="https://$SERVICE.forpreview.com"
else
  url="https://$SERVICE-$clean.forpreview.com"
fi

# Half a minute early, so clock skew against GitHub and the server cannot hide
# this deploy's runs or its container.
since=$(($(date -u +%s) - 30))

# Newest run of a workflow created since the dispatch, polled for two minutes
# until it shows up. A failed listing is retried like an empty one.
# Usage: find_run <repo> <workflow> <title prefix> [gh run list filters...]
find_run() {
  local repo="$1" workflow="$2" prefix="$3"
  shift 3
  local id
  for _ in $(seq 1 24); do
    id="$(gh run list --repo "$repo" --workflow "$workflow" --limit 20 "$@" \
      --json databaseId,displayTitle,createdAt 2>/dev/null |
      jq -r --arg prefix "$prefix" --argjson since "$since" '
        map(select((.displayTitle | startswith($prefix))
          and (.createdAt | fromdateiso8601) >= $since))
        | sort_by(.createdAt) | last | .databaseId // empty' || true)"
    if [ -n "$id" ]; then
      echo "$id"
      return 0
    fi
    sleep 5
  done
  return 1
}

echo "Deploying $branch (${remote_sha:0:12}) to $url"
dispatch_output="$(gh workflow run deploy-studio.yml --repo "$REPO" --ref "$branch" -f service="$SERVICE" 2>&1)" || {
  echo "$dispatch_output" >&2
  die "The dispatch was refused. If it names the service input, the branch predates jant-site previews: merge main into it."
}
echo "$dispatch_output"

run_id="$(grep -oE 'actions/runs/[0-9]+' <<<"$dispatch_output" | head -1 | cut -d/ -f3 || true)"
if [ -z "$run_id" ]; then
  run_id="$(find_run "$REPO" deploy-studio.yml "Deploy $SERVICE" --branch "$branch" --event workflow_dispatch)" ||
    die "Could not find the dispatched run. See https://github.com/$REPO/actions/workflows/deploy-studio.yml"
fi
gh run watch "$run_id" --repo "$REPO" --exit-status --compact >/dev/null ||
  die "The dispatch run failed: https://github.com/$REPO/actions/runs/$run_id"

# The dispatch may have run on a commit pushed after the check above.
sha="$(gh run view "$run_id" --repo "$REPO" --json headSha --jq .headSha)"

wait_minutes=5
if gh run list --repo "$BUILD_REPO" --limit 1 >/dev/null 2>&1; then
  echo "Waiting for the $BUILD_REPO deploy (about four minutes)..."
  build_id="$(find_run "$BUILD_REPO" deploy-external-apps.yml "External · $SERVICE · $branch · " --event repository_dispatch)" ||
    die "No $BUILD_REPO run for $SERVICE · $branch appeared. See https://github.com/$BUILD_REPO/actions"
  gh run watch "$build_id" --repo "$BUILD_REPO" --exit-status --compact -i 10 ||
    die "The deploy failed: https://github.com/$BUILD_REPO/actions/runs/$build_id"
else
  echo "note: no access to $BUILD_REPO, so only the site itself is watched." >&2
  wait_minutes=15
fi

# Until the route exists, the *.forpreview.com catch-all answers with hosted
# Jant, and a failed seed leaves the old container serving. Only this commit,
# from a container started after the dispatch, is this deploy.
expected="${sha:0:16}"
deadline=$(($(date +%s) + wait_minutes * 60))
version=""
started_at=0
while :; do
  body="$(curl -fsS --max-time 20 "$url/readyz?t=$(date +%s)" 2>/dev/null || true)"
  version="$(jq -r '.version // ""' <<<"$body" 2>/dev/null || true)"
  started_at="$(jq -r '.startedAt // 0' <<<"$body" 2>/dev/null || echo 0)"
  if [[ "$version" == *"-$expected" ]] && [ "${started_at:-0}" -ge "$since" ]; then
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    die "$url/readyz reports version '$version' started at '$started_at', not build $expected started after $since. Check the jant-site container logs on the preview server."
  fi
  sleep 10
done

cat <<EOF

Preview ready: $url ($version)
Sign in at $url/signin as $OWNER_EMAIL. To copy the password:
  aws ssm get-parameter --name $PASSWORD_PARAM --with-decryption --query Parameter.Value --output text | pbcopy
Every deploy starts from the demo snapshot again. Remove the preview from studio when done:
  mise run preview-delete $branch $SERVICE
EOF
