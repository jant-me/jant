---
"@jant/core": minor
"create-jant": minor
---

A first path segment that starts with `_` or `.` belongs to Jant: new system addresses go there, as `/_assets`, `/__sso`, and `/.well-known/` already do. A post's `path` now follows the same rule as a custom URL: it starts with a letter or digit and holds only lowercase letters, digits, `-`, `.`, and `/`. A slug derived from underscores no longer starts, ends, or doubles up on a hyphen (`_x` gave `-x`).

**Upgrade notes**

- No database migrations.
- `POST /api/posts` and `jant_posts_create` answer `400` for a `path` outside that rule, such as `_notes/plan`, `~me`, or one with non-ASCII letters. Uppercase letters and extra slashes are still folded away.
- A post address created earlier under a first segment that starts with `_` or `.` now answers `404`, and so does the post's slug, which redirects there. Give the post a new custom URL under Settings → Custom URLs and delete the old one.
