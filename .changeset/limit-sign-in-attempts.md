---
"@jant/core": minor
"create-jant": minor
---

Sign-in and setup are rate limited. Sign-in allows 20 attempts from one client and 10 for one account in 10 minutes; setup allows 20 submissions from one client. Password guesses used to be unlimited. On a demo site, where every visitor signs in to one published account, only the per-client limit applies.

Jant no longer serves better-auth's own endpoints under `/api/auth/`. Nothing in Jant called them, and they sidestepped Jant's pages: `/api/auth/sign-in/email` took password guesses with no limit, and `/api/auth/sign-up/email` could take a new site's first account before its owner reached `/setup`. Sign-in, sign-out, setup, and password changes all go through Jant's own pages.

On Node, a rate limit now counts the address Jant can vouch for. Without `TRUST_PROXY`, `X-Forwarded-For` and `CF-Connecting-IP` from the client are ignored and the connecting address is used; behind a trusted proxy, the last `X-Forwarded-For` entry, the one the proxy added. The first entry used to count, and a client could change it on every request.

**Upgrade notes**

- No database migrations.
- `RATE_LIMIT_ENABLED=false` turns these limits off along with the search limit.
- A Node deployment behind a reverse proxy without `TRUST_PROXY=true` counts every visitor as the proxy's address, so they share one sign-in limit. Set it when a proxy sits in front, as the Docker setup does.
- Requests to `/api/auth/*` answer `404`. A script that signed in there should use an API token instead.
