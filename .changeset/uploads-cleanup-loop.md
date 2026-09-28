---
"@jant/core": minor
"create-jant": minor
---

`jant uploads cleanup` runs batch after batch until nothing is left, as `search reindex` and `posts rebuild-html` do; `--once` runs a single batch. It used to run one batch of 20 and stop. `--limit` now tops out at 200, the largest batch the server runs, and the help says the command also purges deleted media past the recycle window.

**Upgrade notes**

- No database migrations.
- A scheduled `jant uploads cleanup` now finishes the backlog in one run. Add `--once` to keep one batch per run.
