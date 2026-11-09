---
"@jant/core": minor
---

GitHub Sync can now check with GitHub which accounts the author owns before it connects through a GitHub App. With `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` set, connecting has the author authorize the App on GitHub and binds only the installations GitHub says they own. It can also connect an account the App is already installed on, such as after moving the site to a new deployment, where GitHub's install page used to stop.

A deployment that serves several sites, such as the hosted service, now requires both variables. Until now Jant trusted the installation ID in the address GitHub sent the browser back to, so on such a deployment one account could bind another's installation by editing that address. On the hosted service, one GitHub account can now also serve sites that belong to different Jant accounts. A single-site deployment without the variables connects as before.

**Upgrade notes**

- No database migrations.
- Nothing to change on a single-site deployment. To turn on the check:
  1. In the GitHub App settings, under **Identifying and authorizing users**, add `https://<your-jant-site>/settings/github-sync/app/callback` as a **Redirect URI**, and leave **Request user authorization (OAuth) during installation** unchecked.
  2. Generate a client secret, and copy the client ID.
  3. Set `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` on the deployment.
