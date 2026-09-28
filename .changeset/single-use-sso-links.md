---
"@jant/core": patch
"create-jant": patch
---

A hosted sign-in link signs in once. Opening the same link again before it expires shows the expired-link page, with the way back to the hosted account. It used to sign in every time until it expired, so a link that turned up in a log or browser history could be reused.

**Upgrade notes**

- No database migrations.
