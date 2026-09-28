---
"@jant/core": patch
"create-jant": patch
---

A password reset link resets the site owner's password. It used to reset the first account in the database, which on a server hosting several sites could belong to another site. On such a server, deleting a site from its own settings is refused, since it would have emptied every site's tables; the hosted control panel deletes sites.

**Upgrade notes**

- No database migrations.
