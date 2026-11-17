# Stats

Jant counts page views and shows them under **Settings → Stats**: today by the hour, or the last 7 or 30 days by the day; the ten most-viewed pages in that window (posts, collections, the home page, the archive), ranked, with a bar for each one's share; and where readers came from. Open any page in the list to see its own numbers, or any referrer to see the pages it sent readers to.

The counts are the whole record. Jant stores nothing about any reader, sets no cookie, and sends nothing to anyone else. Counts older than 30 days are deleted, and the hours of a day the day after. There is no lifetime total and no comparison with the window before.

While the day counting began falls inside the window, the total says since when, and the chart starts on that day.

## What counts as a view

A view is a page a reader kept in front of them: the home page, a post, a collection, the archive, `/featured`, or `/subscribe`, open for five seconds, or sooner when the reader scrolls, taps, or presses a key. The page's own script then tells your site once; the message names the page and where the reader came from, nothing about the reader. Feeds, search, and anything you open while signed in do not count. Neither do crawlers, link previews, prefetches, and automated browsers, which leave a page long before five seconds. A reader with scripts turned off is not counted.

A post's number is how often its page was opened, plus how often it was read in full in a list without being opened: on the home page, in a collection, on `/featured`, or in the archive's list view. Read in full means every part of it was on screen, nothing of it was left folded, every item of a media row that scrolls sideways was seen, and it stayed in view long enough to read its text. A titled post shows only an excerpt in a list, so only its page counts.

A Thread counts as one post, listed under its first: opening any of its posts counts toward it, and so does reading all of it in a list. A Thread too long to show whole in a list counts only when opened. One page load counts a post once, and a post opened from the list counts on its own page. A read in a list is a view like a page opened, in the total, the chart, and the referrers too: the home page opened and three notes read on it are four views.

The later pages of the home feed and a filtered archive count toward the home page and the archive. A post or a collection keeps its count when its address changes.

## Referrers

A referrer is the site a reader followed a link from, reduced to its domain. The addresses a well-known site goes by are folded into one: `old.reddit.com`, `redd.it` and the Reddit app count as `reddit.com`, `t.co` as `x.com`, `google.co.uk` as `google.com`. A link tagged with `utm_source` or `ref` is filed under that tag instead, wherever it was opened: `?utm_source=newsletter` counts as `newsletter`, `?utm_source=twitter` as `x.com`, and ChatGPT tags the links in its answers with `utm_source=chatgpt.com`. An Android app that names itself counts as its site, or by its package name (`com.example.app`) when Jant does not know the app. **Internal** is a reader moving from one page of your site to another. **Direct** is a visit with neither tag nor referrer: a typed address, a bookmark, or an untagged link from an app, an email, or a feed reader. Most apps send no referrer, so Direct is usually a large line. **Other** is everything past the ten listed; it is the one row that does not open.

## Turning it off

Uncheck **Count page views** at the bottom of the Stats page. Counting stops and every count is deleted. The setting is `STATS_ENABLED`; see [Configuration](configuration.md#settings-page-options).

## Limits

On Cloudflare, counting stops after 20,000 views in a day and resumes the next day. `STATS_DAILY_LIMIT` sets the number; `0` means no limit, and is the default with Docker. See [Configuration](configuration.md#stats-optional).

Stats are not part of an [export](export-and-import.md) and do not move with a site.

## What's next

- [Code injection](code-injection.md) — add an external analytics service when you want more than Jant keeps
- [Configuration](configuration.md) — every setting
