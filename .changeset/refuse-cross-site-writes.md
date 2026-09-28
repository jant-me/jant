---
"@jant/core": patch
"create-jant": patch
---

A signed-in browser's session can no longer be used by another site's page. A request that changes something and carries the session cookie must come from the site itself, or from an origin `CORS_ORIGINS` names; otherwise it gets `403`. Blogs that share a parent domain, such as hosted blogs, were exposed: a page on one could save Code Injection on another whose author was signed in. On a demo site, Code Injection and custom CSS are now locked, since everyone signs in with the same account.

**Upgrade notes**

- No database migrations.
- API tokens aren't affected. A browser extension that calls the API with the session cookie needs its origin in `CORS_ORIGINS`.
