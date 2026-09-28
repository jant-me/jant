---
"@jant/core": patch
"create-jant": patch
---

The feed reference lists the older addresses that still redirect. It said every `/{page}/feed/atom.xml` did; only the latest, featured, and archive feeds' do, and the `/feed/*/atom.xml` forms were missing.

**Upgrade notes**

- No database migrations.
