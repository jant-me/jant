---
"@jant/core": patch
"create-jant": patch
---

The deploy workflow new projects get deploys again. Its "Check deploy prerequisites" step read `database_id` from `wrangler.toml` with a sed pattern escaped twice, so it never found the ID: every push skipped the deploy with "Replace the placeholder D1 `database_id`" in the run summary, and the run still showed as passed. Projects created since March 2026 have this workflow, so a site that relied on it has kept the version it was first deployed with.

**Upgrade notes**

- No database migrations.
- In a project created before this release, fix the line in `.github/workflows/deploy.yml` that sets `database_id`: its sed pattern should read `'s/^database_id = "\([^"]*\)".*/\1/p'`, with one backslash before each parenthesis and before the `1`. Or copy the file from a new project made with the same package manager. Then push, or run the workflow by hand, to deploy the current version.
