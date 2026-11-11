---
"@jant/core": patch
---

A share image keeps the font theme's web fonts on a site that serves its assets from another host through `ASSET_BASE_URL`, as Jant's hosted sites do. The image used to fall back to a local font while the card was laid out in the web font, so its lines broke in other places and a gap could open under the title. The capture can now read the font rules in the site's stylesheets on the asset host, and it refetches any stylesheet whose cached copy it cannot read.

**Upgrade notes**

- No database migrations.
