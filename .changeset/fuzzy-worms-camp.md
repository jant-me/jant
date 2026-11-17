---
"@jant/core": minor
"create-jant": minor
---

On **Settings → Stats**, a post now also counts when a reader read all of it in a list without opening its page: on the home page, in a collection, on `/featured`, or in the archive's list view. An untitled note is read in full on the home page and rarely opened, so its count used to stay near zero beside titled posts that show only an excerpt in a list. Read in full means every part of the post was on screen, nothing of it was left folded, every item of a media row that scrolls sideways was seen, and it stayed in view long enough to read its text.

A Thread counts as one post, listed under its first: opening any of its posts counts toward it, and so does reading all of it in a list. One page load counts a post once, and a read in a list counts in the total, the chart, the hours, and the referrers too. Nothing about any reader is stored or kept.

**Upgrade notes**

- Two database migrations on `view_count`. Run `jant migrate` before starting the new version, as on every upgrade.
