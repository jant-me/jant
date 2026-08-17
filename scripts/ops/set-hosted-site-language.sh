#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: set-hosted-site-language.sh [--dry-run|--apply] [--container postgres-postgres-1]

Correct SITE_LANGUAGE on the hosted fleet for sites that write Chinese but were
left on the English default. Dry-run is the default and only reads.

This is a one-off operations fix for OUR hosted deployment, not a product data
fix. It deliberately does NOT live in src/db/backfills/: those run on every Jant
instance through `jant migrate`, and the premise here — that these authors were
recruited in mainland China — is true only of this fleet. Flipping a
self-hosted English blog to Chinese would be plain wrong.

Selection: every site whose SITE_LANGUAGE is missing or names no CJK profile,
minus the opt-outs below. Sites already on zh / ja / ko are left alone, which
also makes the script idempotent: a second run selects nothing.

  - foriforrest.jant.blog -> zh-Hant (its posts are Traditional, and its author
    had set the removed CJK_SERIF_FONT to zh-Hant)
  - blog.jant.me          -> skipped, it is English on purpose
  - ggsddu.jant.blog      -> skipped, it publishes no Chinese
  - everything else       -> zh-Hans

Run on the production host. Uses the postgres container directly; no .env
needed. --apply writes a rollback script next to the working directory before
touching anything, and runs the whole change in one transaction.
EOF
}

mode="dry-run"
container="postgres-postgres-1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      mode="dry-run"
      shift
      ;;
    --apply)
      mode="apply"
      shift
      ;;
    --container)
      container="${2:-}"
      if [[ -z "$container" ]]; then
        echo "--container requires a value" >&2
        exit 2
      fi
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

psql_run() {
  docker exec -i "$container" psql -U postgres -d jant -v ON_ERROR_STOP=1 "$@"
}

# Shared selection. `hosts` carries every domain a site answers on, so an opt-out
# matches whichever hostname it was written as.
read -r -d '' SELECTION <<'SQL' || true
WITH lang AS (
  SELECT site_id, value AS current_lang
  FROM site_setting
  WHERE key = 'SITE_LANGUAGE'
), hosts AS (
  SELECT site_id, array_agg(host) AS hosts
  FROM site_domain
  GROUP BY site_id
), target AS (
  SELECT
    s.id AS site_id,
    coalesce(array_to_string(h.hosts, ','), '(no domain)') AS host,
    coalesce(l.current_lang, '(unset)') AS current_lang,
    CASE
      WHEN 'foriforrest.jant.blog' = ANY(coalesce(h.hosts, '{}')) THEN 'zh-Hant'
      ELSE 'zh-Hans'
    END AS next_lang
  FROM site s
  LEFT JOIN lang l ON l.site_id = s.id
  LEFT JOIN hosts h ON h.site_id = s.id
  WHERE coalesce(l.current_lang, 'en') !~* '^(zh|ja|ko)'
    AND NOT (coalesce(h.hosts, '{}') && ARRAY['blog.jant.me', 'ggsddu.jant.blog'])
)
SQL

if [[ "$mode" == "dry-run" ]]; then
  echo "== Sites that would change =="
  psql_run <<SQL
$SELECTION
SELECT format('%-52s %-10s -> %s', host, current_lang, next_lang) FROM target ORDER BY host;
SQL
  echo
  echo "== Totals =="
  psql_run <<SQL
$SELECTION
SELECT format('%s: %s', next_lang, count(*)) FROM target GROUP BY next_lang ORDER BY next_lang;
SQL
  echo
  echo "Dry run only. Re-run with --apply to commit."
  exit 0
fi

stamp="$(date +%Y%m%d-%H%M%S)"
rollback="./site-language-rollback-${stamp}.sql"

echo "== Writing rollback to ${rollback} =="
psql_run -tA <<SQL >"$rollback"
$SELECTION
SELECT CASE
  WHEN current_lang = '(unset)'
    THEN format('DELETE FROM site_setting WHERE site_id=%L AND key=''SITE_LANGUAGE''; -- %s (had no row)', site_id, host)
  ELSE format('UPDATE site_setting SET value=%L, updated_at=extract(epoch from now())::int WHERE site_id=%L AND key=''SITE_LANGUAGE''; -- %s', current_lang, site_id, host)
END
FROM target ORDER BY host;
SQL
echo "  $(wc -l <"$rollback") statements"

echo "== Applying =="
psql_run <<SQL
BEGIN;
$SELECTION
, applied AS (
  INSERT INTO site_setting (site_id, key, value, updated_at)
  SELECT site_id, 'SITE_LANGUAGE', next_lang, extract(epoch from now())::int FROM target
  ON CONFLICT (site_id, key) DO UPDATE
    SET value = excluded.value, updated_at = excluded.updated_at
  RETURNING site_id, value
)
SELECT format('%s: %s', value, count(*)) FROM applied GROUP BY value ORDER BY value;
COMMIT;
SQL

echo "== Verify: sites still on a non-CJK language =="
psql_run -tA <<'SQL'
SELECT coalesce(ss.value, '(unset)') || ' | ' || coalesce(array_to_string(array_agg(sd.host), ','), '(no domain)')
FROM site s
LEFT JOIN site_setting ss ON ss.site_id = s.id AND ss.key = 'SITE_LANGUAGE'
LEFT JOIN site_domain sd ON sd.site_id = s.id
GROUP BY s.id, ss.value
HAVING coalesce(ss.value, 'en') !~* '^(zh|ja|ko)'
ORDER BY 1;
SQL

echo
echo "Done. Roll back with: docker exec -i ${container} psql -U postgres -d jant -v ON_ERROR_STOP=1 < ${rollback}"
