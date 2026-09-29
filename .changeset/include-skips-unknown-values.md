---
"@jant/core": minor
"create-jant": minor
---

The Thread lists' `include` skips a value it doesn't offer instead of answering `400`. It's the parameter later releases add values to, and a site keeps running the release it was deployed with, so a client asking an older site for a newer extra now gets the Threads and the extras that site has, as it does for any parameter it doesn't know.

**Upgrade notes**

- No database migrations.
