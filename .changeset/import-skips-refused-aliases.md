---
"@jant/core": patch
"create-jant": patch
---

`jant site import` no longer stops when it can't recreate one of a post's old addresses. An export from an earlier release can list aliases this release refuses, such as `/~me`, and the import exited there with the site half imported. It now warns, names the address, and goes on, as it already did for a Collection's; the summary counts the aliases it skipped.

**Upgrade notes**

- No database migrations.
