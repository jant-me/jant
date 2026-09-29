---
"@jant/core": patch
"create-jant": patch
---

New projects' `wrangler.toml` sets `keep_vars = true`, so a deploy keeps the variables set in the Cloudflare dashboard. The deployment guide offers the dashboard for `R2_PUBLIC_URL` and `IMAGE_TRANSFORM_URL`, but Wrangler deletes dashboard variables the file doesn't list on every deploy, so the next push after setting them there removed them without a word: media went back through the Worker and images stopped resizing.

**Upgrade notes**

- No database migrations.
- In a project created before this release, add `keep_vars = true` near the top of `wrangler.toml`, before the first `[section]`. If you set variables in the dashboard, check that they're still there, since a deploy may already have removed them, and set them again, or move them into `[vars]`.
