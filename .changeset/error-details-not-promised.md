---
"@jant/core": patch
"create-jant": patch
---

Compatibility and the API reference say an error's `details`, apart from the settings endpoint's `rejectedKeys`, and the wording of its `error` message can change in any release. Branch on `code`.

**Upgrade notes**

- No database migrations.
