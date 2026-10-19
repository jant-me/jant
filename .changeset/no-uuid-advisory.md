---
"@jant/core": patch
"create-jant": patch
---

`npm install` on a new site no longer reports 3 moderate severity vulnerabilities. They came from `uuid` 10, which `typeid-js` still asks for in its latest release. The advisory covers `uuid` functions Jant never called, but npm's suggested fix, `npm audit fix --force`, would have downgraded `@jant/core` to 0.3.38. Jant now makes and checks its IDs itself, in the same format and order as before, and no longer installs `typeid-js` or `uuid`.

**Upgrade notes**

- No database migrations.
- If your site's own code imports `typeid-js` or `uuid`, add it to your site's `package.json`.
