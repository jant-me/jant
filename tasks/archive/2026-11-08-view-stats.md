# View stats: a quiet page of counts, never a scoreboard

Branch: `feat/view-stats`. Design discussed with Owen on 2026-11-08; the
decisions below are settled, the checklist is the work.

## Design

**What it is.** One author-only page, `/settings/stats`: views per day for the
last 7 / 30 / 90 days, the ten most-viewed posts in that window, and the
referrer domains readers came from. Click a post to see its own days and
referrers (`?post=<id>`). Nothing public, no numbers anywhere else, no
notifications, no totals, no comparisons to last month.

**Counting.** Server-side, after the response, from request facts alone. A view
is a `GET` that answered `200 text/html` to an anonymous reader whose request
carries `Sec-Fetch-Dest: document` + `Sec-Fetch-Mode: navigate`, is not a
prefetch (`Sec-Purpose` / `Purpose`), and whose User-Agent is not on the short
bot list. No JS beacon, no cookies, no IP, no UA stored. Routes name the page
(`c.set("viewTarget", …)`): post pages by post id, home / collection / featured
pages by path. Search, settings, feeds, API, partials never count.

**Storage.** One table in both dialects:

| column   | meaning                                                       |
| -------- | ------------------------------------------------------------- |
| site_id  | FK → site, cascade                                            |
| day      | `YYYY-MM-DD` in the site's time zone                          |
| page     | post id (`pst_…`) or the path of a non-post page              |
| referrer | host, lowercased, `www.` stripped; `""` = direct or same-site |
| count    | views                                                         |

PK `(site_id, day, page, referrer)`, no other index: every read is a prefix
range on `(site_id, day)`. A row is a counter, not a visit. Not exported, not
in snapshots (`SNAPSHOT_EXCLUDED_TABLES`).

**Writes.** Hits accumulate in a process-level buffer and flush after 5 s as one
batch of upserts (`ON CONFLICT … count = count + excluded.count`). One flush
sweeps rows older than 90 days for the sites it touched, once per day per
process. Bounds:

- 5,000 rows per site per day: once a site-day has that many rows, new
  `(page, referrer)` pairs fold into the `('*','*')` overflow row. Totals stay
  right, the breakdown stops growing. Only reachable by a referrer-spraying
  script. The check runs only when the flush carries keys this process has not
  upserted before (`SELECT COUNT(*)` on the site-day prefix).
- `STATS_DAILY_LIMIT` (env, integer ≥ 0): after this many views written in one
  day the instance stops writing until the next day. Default 20,000 on Cloudflare
  (free-tier D1 allows 100,000 rows written per day and refuses every query
  once exceeded), 0 = unlimited on Node, where no quota exists. That day shows
  as "20,000+".

**Setting.** `STATS_ENABLED` (boolean, default `true`, Config Editor + a
checkbox on the stats page). Turning it off deletes the site's rows.

**Reads.** Three independent queries sent together: per-day sums, top ten
posts joined to `post` for title/slug, referrer sums (top ten, `other`, direct).
Per-post view: the same two for one page key.

**Not in this change.** Uniques, countries, devices, public API, MCP tool, a
chart library (bars are server-rendered SVG), counting on feeds, any number on a
public page.

## Checklist

- [x] Schema: `view_count` in `src/db/schema.ts` and `src/db/pg/schema.ts`;
      migrations generated for both; snapshot exclusion registered
- [x] Config: `STATS_ENABLED` (no editor, like `DISCOVER`: the Stats page is
      the only writer, so off always deletes) and `STATS_DAILY_LIMIT`
      (env-only) in `CONFIG_FIELDS`, `Bindings`, `ENV_RULES`, `AppConfig`,
      `resolve-config`; snapshot setting exclusion
- [x] `lib/view-counting.ts`: should-count predicate, referrer host, day keys
- [x] `lib/view-buffer.ts`: buffered flush with keep-alive hook and daily stop
- [x] `services/stats.ts`: `record`, `getOverview`, `getPost`, `clear`,
      `setEnabled`; wired into `createServices`
- [x] `middleware/view-counter.ts` mounted after `withConfig`; routes set
      `viewTarget` (post page, home, collection, smart collection, featured,
      archive, collections directory, subscribe)
- [x] `/settings/stats` route (+ `?days=`, `?post=`), `POST /settings/stats`
      for the checkbox; breadcrumb; settings root entry
- [x] `ui/dash/settings/StatsContent.tsx`; CSS in `components-author.css`
- [x] i18n: extract, write zh-Hans / zh-Hant
- [x] Docs: `docs/stats.md` + zh-Hans, SUMMARY entries, configuration tables
      (both languages), code-injection analytics note; public-surface fixture
- [x] Tests: counting predicate, buffer, service (cap, sweep, limit, reads,
      clear), middleware through `createTestApp`, route
- [x] `mise run check-tests` (5504 pass; `demo-canonical-snapshot` needs a
      local wrangler environment), `check-lint`, `check-copy`, `i18n-build`
- [x] Look at the page in `mise run dev-debug` and count a view through the
      Workers runtime (D1 batch, `waitUntil`)

## Results

- `mise run check-types`, `check-lint`, `check-copy`, `check-format`: clean.
  `check-tests`: 5504 pass; `demo-canonical-snapshot` failed inside the full
  run with `ECONNREFUSED 127.0.0.1:3000` and passes on its own, so it is a
  port collision in the suite, not the new migration.
- Through `mise run dev-debug` (wrangler, local D1): migration 0035 applied;
  navigations with `Sec-Fetch-*` headers to `/` and a post page were counted,
  a plain `curl` was not; the referrer host, the post row, the per-post page
  and the breadcrumb all rendered; no flush error in the Worker log.
- Screenshot of `/settings/stats?days=7` taken with the Playwright headless
  Chromium from `~/Library/Caches/ms-playwright` (the Chrome extension cannot
  open local dev ports).
- Not exercised: Postgres (`check-pg-smoke` needs a database), the daily
  limit on a real D1 quota, and the confirm dialog of the off switch in a
  browser.
