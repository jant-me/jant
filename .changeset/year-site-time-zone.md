---
"@jant/core": minor
"create-jant": minor
---

A `year` condition reads the calendar in the site's time zone (`TIME_ZONE`) everywhere: the archive's `?year=` and its year picker, the archive grid's month headers, archive feeds, smart collections, and `GET /api/threads` and `GET /api/public/threads`. The year filter and the year picker used to read UTC while the grid grouped months by the site's time zone, so on a site ahead of or behind UTC a post from the first or last hours of a year appeared under the wrong year.

**Upgrade notes**

- No database migrations.
- On a site whose time zone isn't UTC, posts published within the UTC offset of New Year move to the year the site's calendar gives them. A smart collection with a year condition gains or loses those posts.
