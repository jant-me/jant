---
"@jant/core": patch
"create-jant": patch
---

`GET /api/public/archive` orders posts by publication date, newest first, as documented and as the `/archive` page does by default. It sorted by latest thread activity, so a new reply moved an old thread to the top. Cursor pagination follows the same order.
