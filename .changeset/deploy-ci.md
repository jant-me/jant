---
"@jant/core": minor
"create-jant": minor
---

`jant deploy --ci` deploys from an automated run, and the deploy workflow new projects get only installs dependencies and runs it. With neither `CLOUDFLARE_API_TOKEN` nor `CLOUDFLARE_ACCOUNT_ID` set, it skips the deploy without failing, as the workflow did in a repo without the secrets. With `database_id = "local"`, it stops and says to run the first deploy on your computer, where the workflow skipped and still passed. A skip or a stop also goes into the GitHub Actions run summary. These checks used to be shell in the workflow, the copy in each project's own repo that no upgrade reaches, and the one that read `database_id` skipped every deploy from March until 0.11.0. Now they come from the installed `@jant/core`.

`jant deploy -- --dry-run` without `--skip-migrate` is refused. Wrangler got the flag, but the remote migrations had already run.

**Upgrade notes**

- No database migrations.
- A project's existing workflow keeps working. To switch to the short one, replace `.github/workflows/deploy.yml` as [Upgrading](https://jant.me/docs/upgrading#cloudflare-sites) shows.
- `jant deploy -- --dry-run` without `--skip-migrate` fails before it changes anything. Add `--skip-migrate` to dry-run the Worker upload alone.
