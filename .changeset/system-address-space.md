---
"@jant/core": patch
"create-jant": patch
---

A first path segment that starts with `_` or `.` belongs to Jant: new system addresses go there, as `/_assets`, `/__sso`, and `/.well-known/` already do. A post created with such a `path` is now refused as reserved, the way a custom URL already was, and a slug derived from underscores no longer starts, ends, or doubles up on a hyphen (`_x` gave `-x`).

**Upgrade notes**

- No database migrations.
