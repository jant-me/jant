---
"@jant/core": patch
"create-jant": patch
---

A redirect to a post's or Collection's one address keeps the query string. `/more-notes?sort=oldest` used to redirect to `/notes`, dropping the sort and the page a reader had saved with the link. A custom URL that redirects to a path on the site without a query string of its own now passes the reader's along too; one with its own query string, or one to another site, goes where it says.

**Upgrade notes**

- No database migrations.
