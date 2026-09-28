---
"@jant/core": patch
"create-jant": patch
---

Redirects stay on the site. An address such as `//example.com/` was redirected to `//example.com`, which a browser follows to another host, and the `301` is cached for good; it now redirects to `/example.com`. The hosted and local sign-in links also refuse a `redirect` target that starts with `/\`.

**Upgrade notes**

- No database migrations.
