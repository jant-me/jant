#!/usr/bin/env bash
# Run the Docker quick start from docs/deployment-docker.md against an image.
#
# Usage: scripts/docker-smoke.sh <image>
#
# Uses this checkout's compose.yml and .env.example, gives the data directory to
# UID 1000 the way the docs tell a Linux host to, and brings the stack up. Then
# checks that migrations ran, the container reports healthy, `jant` is on the
# PATH at the checkout's version, the setup page renders from each catalog,
# `jant setup` creates the site, and the home page and feed serve it.
set -euo pipefail

image="${1:?Usage: scripts/docker-smoke.sh <image>}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
port="${JANT_SMOKE_PORT:-3000}"
site_dir="$(mktemp -d)"
project="jant-smoke-$$"
site_name="Docker smoke"

compose() {
  docker compose --project-directory "$site_dir" --project-name "$project" "$@"
}

fail() {
  echo "docker smoke: $*" >&2
  exit 1
}

cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    compose logs --no-color || true
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  # The container wrote data/ as UID 1000, which may not be the caller.
  rm -rf "$site_dir" 2>/dev/null || sudo rm -rf "$site_dir" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

cp "$repo_root/compose.yml" "$site_dir/compose.yml"
sed "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" \
  "$repo_root/.env.example" >"$site_dir/.env"
printf 'IMAGE=%s\nHOST_PORT=%s\n' "$image" "$port" >>"$site_dir/.env"
mkdir -p "$site_dir/data"
if [[ "$(uname -s)" == "Linux" ]]; then
  sudo chown 1000:1000 "$site_dir/data"
fi

compose up -d

migrate="$(compose ps --all --quiet jant-migrate)"
[[ "$(docker inspect --format '{{.State.ExitCode}}' "$migrate")" == "0" ]] ||
  fail "jant-migrate did not exit cleanly"

app="$(compose ps --quiet jant)"
health=""
for _ in $(seq 1 60); do
  health="$(docker inspect --format '{{.State.Health.Status}}' "$app")"
  [[ "$health" == "healthy" || "$health" == "unhealthy" ]] && break
  sleep 2
done
[[ "$health" == "healthy" ]] || fail "container health is '$health'"

readiness="$(curl -fsS "http://127.0.0.1:$port/readyz")"
[[ "$readiness" == *'"status":"ok"'* ]] || fail "/readyz answered $readiness"

expected_version="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$repo_root/packages/core/package.json")"
version="$(compose exec -T jant jant --version)"
[[ "$version" == *"$expected_version"* ]] ||
  fail "jant --version printed '$version', expected $expected_version"
compose exec -T jant jant --help >/dev/null

# Setup picks its language from the browser, so it reaches every catalog. A
# production build keeps only each message's ID, so a catalog keyed
# differently from what the Lingui SWC plugin generated prints IDs here.
for pair in "en|Welcome to Jant" "zh-CN|欢迎使用 Jant" "zh-TW|歡迎使用 Jant"; do
  page="$(curl -fsS -H "Accept-Language: ${pair%%|*}" "http://127.0.0.1:$port/setup")"
  [[ "$page" == *"${pair#*|}"* ]] ||
    fail "/setup for ${pair%%|*} does not show '${pair#*|}'"
done

openssl rand -hex 16 | tr -d '\n' |
  compose exec -T jant jant setup \
    --email smoke@example.com --password-stdin --site-name "$site_name"

home="$(curl -fsS "http://127.0.0.1:$port/")"
[[ "$home" == *"$site_name"* ]] || fail "the home page does not show the site name"
feed="$(curl -fsS "http://127.0.0.1:$port/feed")"
[[ "$feed" == *"<feed"* ]] || fail "/feed is not an Atom feed"

echo "Docker smoke passed: $image"
