---
"@jant/core": patch
"create-jant": patch
---

The Docker image carries uuid 11.1.1 or later, past the advisory an image scanner reports against the uuid 10 that typeid-js asks for. Jant never called the affected functions. A site installed from npm resolves uuid itself and is unchanged.

**Upgrade notes**

- No database migrations.
