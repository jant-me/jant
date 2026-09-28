---
"@jant/core": minor
"create-jant": minor
---

`jant site import` and `jant site pull-media` read `jant-site-export.zip` by default, the file `jant site export` writes, so the three commands chain without `--path`. `site import` used to read the current directory. `site pull-media` takes `-o` for `--output`, as `site export` does.

**Upgrade notes**

- No database migrations.
- A `jant site import` that relied on reading the current directory needs `--path .`.
