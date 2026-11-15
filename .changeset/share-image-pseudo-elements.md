---
"@jant/core": patch
---

A share image keeps its fine marks on a site that serves its assets from another host through `ASSET_BASE_URL`, as Jant's hosted sites do: the fade where the summary stops short of the post, a Thread's rail and the dots between its posts, and the short rule before a quote's source. The image used to leave them all out. The share stylesheet was linked without CORS, so the page could not read its rules, and the capture paints a `::before` or `::after` only from rules it can read. The asset host already has to allow cross-origin requests for the client bundle, so its setup stays the same.

**Upgrade notes**

- No database migrations.
