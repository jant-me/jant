# Stats

Jant counts page views and shows them under **Settings → Stats**: views per day for the last 7, 30, or 90 days, the ten most-read posts in that window, and the sites readers came from. Open a post in the list to see its own days and referrers.

The counts are the whole record. Jant stores nothing about any reader, sets no cookie, and adds no script to your pages. Counts older than 90 days are deleted. There is no lifetime total and no comparison with the window before.

## What counts as a view

A view is a reader's browser opening a page: the home page, a post, a collection, the archive, `/featured`, or `/subscribe`. Feeds, search, and anything you open while signed in do not count. Neither do crawlers, link previews, and prefetches.

A post's number is how often its own page was opened. A note read on the home page counts toward the home page, not the note.

## Referrers

A referrer is the site a reader followed a link from, reduced to its domain. The addresses a well-known site goes by are folded into one: `old.reddit.com`, `redd.it` and the Reddit app count as `reddit.com`, `t.co` as `x.com`, `google.co.uk` as `google.com`. A link tagged with `utm_source` or `ref` is filed under that tag instead, wherever it was opened: `?utm_source=newsletter` counts as `newsletter`, `?utm_source=twitter` as `x.com`, and ChatGPT tags the links in its answers with `utm_source=chatgpt.com`. An Android app that names itself counts as its site, or by its package name (`com.example.app`) when Jant does not know the app. **Direct** is a visit with neither tag nor referrer: a typed address, a bookmark, or an untagged link from an app, an email, or a feed reader. Most apps send no referrer, so Direct is usually the largest line. **Other** is everything past the ten listed.

## Turning it off

Uncheck **Count page views** at the bottom of the Stats page. Counting stops and every count is deleted. The setting is `STATS_ENABLED`; see [Configuration](configuration.md#settings-page-options).

## Limits

On Cloudflare, counting stops after 20,000 views in a day and resumes the next day. `STATS_DAILY_LIMIT` sets the number; `0` means no limit, and is the default with Docker. See [Configuration](configuration.md#stats-optional).

Stats are not part of an [export](export-and-import.md) and do not move with a site.

## What's next

- [Code injection](code-injection.md) — add an external analytics service when you want more than Jant keeps
- [Configuration](configuration.md) — every setting
