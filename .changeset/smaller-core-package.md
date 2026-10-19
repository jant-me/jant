---
"@jant/core": patch
---

`@jant/core` no longer ships its tests or the source copies of its fonts, which a site never loads. A Cloudflare site downloads the package on every deploy, and it was 48 MB, with each release adding about 2 MB of test fixtures. It is now 23 MB. Sites serve the same built fonts as before.

**Upgrade notes**

- No database migrations.
