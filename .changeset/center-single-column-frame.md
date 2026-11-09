---
"@jant/core": patch
---

Below 1024px, where footnotes stop sitting in a side rail, the page centers on the reading column. Until now the column kept the wide-screen left margin and left the rest of the width empty on its right: on a 951px screen, such as an iPhone Duo opened flat, that was 119px on the left and 307px on the right. The header, posts, and footer now share one centered column, and everything in it stays aligned to its left edge. Settings and the full-page composer keep their full width.

Header links now move into **More** by the width of the header rather than the window. On a reader page below 1024px the header is as wide as the reading column, so from 781px to 1024px it shows three links where it showed four or more.

For themes: `--layout-reading-measure` (default `35rem`) sets the reading column's width below 1024px, and the page frame narrows to it. Settings and the full-page composer add `.site-page-wide` to `.site-page`.

**Upgrade notes**

- No database migrations.
