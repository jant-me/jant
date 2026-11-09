---
"@jant/core": minor
---

Jant counts page views and shows them under **Settings → Stats**: today by the hour, or the last 7 or 30 days by the day; the ten most-opened pages of the window (posts, collections, the home page, the archive), ranked, with a bar for each one's share; and where readers came from. Every page in the list opens on its own, with its own numbers. While the day counting began falls inside the window, the total says since when, and the chart starts on that day. Counting is on from the start; unchecking **Count page views** at the bottom of the page turns it off and deletes every count.

The counts are the whole record. Nothing is stored about any reader: no cookie, no script on the page, no address. A view is a browser opening a page, from someone who is not signed in and is not a known crawler; feeds, search, prefetches and link previews do not count. What is kept is one counter per site, day, page and referrer for 30 days, and one total per hour for today's chart. Posts, collections and smart collections are counted by id, so a count survives a change of address; the home page, the archive and the other pages by their path. A referrer is the site a reader followed a link from, reduced to the address it is listed under: `old.reddit.com` and `redd.it` count as `reddit.com`, `t.co` as `x.com`, `google.co.uk` as `google.com`. A link tagged with `utm_source` or `ref` is filed under that tag instead, which is how a link opened from an app or from ChatGPT's answers gets a source at all. A reader moving from one page of the site to another is **Internal**, kept apart from **Direct**, which is a visit with neither tag nor referrer.

On Cloudflare, counting pauses after `STATS_DAILY_LIMIT` views in a day, 20,000 by default, so a well-read day stays inside the free-tier D1 write quota; Node and Docker have no limit unless one is set. `STATS_ENABLED` is the switch, as a setting or an environment variable. Counts are not part of an export and do not move with a site. See [Stats](https://jant.me/docs/stats).

**Upgrade notes**

- Two database migrations, which create the `view_count` and `view_hour` tables. Run `jant migrate` before starting the new version, as on every upgrade.
