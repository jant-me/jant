---
"@jant/core": patch
"create-jant": patch
---

The API reference documents the two addresses GitHub calls, `/api/github-sync/webhook` and `/api/github-sync/app-webhook`, with the secret each checks. Both live in GitHub's settings, so they change only in a major release.

**Upgrade notes**

- No database migrations.
