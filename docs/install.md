# Install with an AI assistant

This page is written for an AI assistant that can run commands, such as Claude Code or Codex. Send it this line:

```text
Read https://jant.me/docs/install.md and help me set up a Jant site.
```

The assistant asks where the site should run, follows the guide for that choice, and hands back the steps only you can do, such as signing in to Cloudflare and choosing your admin password.

## Instructions for the assistant

You are helping a person set up a Jant site: a self-hosted, single-author blog. Work through the steps below in order. Talk to the person in their language.

### 1. Check before you ask

Find out what you can without asking:

- Whether the current directory is a Jant project: its `package.json` depends on `@jant/core`. A project with a `wrangler.toml` runs on Cloudflare, so the choice of host is already made.
- Whether it is a git repository, and its remote.
- `node --version`. Jant needs Node.js 24 or later.
- `docker --version` and `docker compose version`, when the site may run in Docker on this computer.

If the person's request already names a repository, a host, or a domain, take it as an answer.

### 2. Ask once

Ask the questions the checks didn't answer in a single message, each with its default, so that "use the defaults" is a full answer:

1. **Where should the site run?**
   - **Cloudflare** (default): no server to maintain. A personal site usually stays within the free tier.
   - **Their own server, in Docker**: they maintain the server.
   - **Hosted Jant**: jant.me runs it for $10.46 a year.
   - **Only on this computer for now**: to try it before choosing.
2. **Is there a domain to use now?** Default: no. The site starts on the address its host gives it, and a domain can be added later.
3. **Only for Docker:**
   - How to reach the server: an SSH host such as `user@server`, or this computer.
   - Whether a reverse proxy with HTTPS (Caddy, Nginx, Traefik) already runs there. Default: no.
   - The database: SQLite (default) or Postgres.
   - Where media goes: the server's disk (default) or S3-compatible storage.

Then say in one or two sentences what you are about to do, and start.

### 3. Follow the guide for the answer

Read the guide before running anything from it. Each page here is also served as Markdown, at its address with `.md` added.

| Answer                                       | What to do                                                                                                                                                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare, no project yet                   | Run `npm create jant@latest <name>`, then follow [Local development first, then deploy](deployment.md#local-development-first-then-deploy). `npm run deploy` creates the D1 database, the R2 bucket, and `AUTH_SECRET` on the first run.             |
| Cloudflare, project in the current directory | Follow the same section from `npm run deploy`.                                                                                                                                                                                                       |
| Cloudflare, site deployed with the button    | Clone the repository it created, run `npm install` and `npm run dev`. [Clone locally](deployment.md#clone-locally-recommended) explains what that copy is for. Pushing to `main` deploys.                                                            |
| Docker                                       | Follow [Deploy with Docker](deployment-docker.md) on the server. Generate `AUTH_SECRET` there and write it into `.env` without printing it: `printf 'AUTH_SECRET=%s\n' "$(openssl rand -base64 32)"`. With a domain, read the reverse proxy section. |
| Hosted Jant                                  | Send the person to [Use Hosted Jant](hosted.md). Signing up and paying are theirs. Your part ends here.                                                                                                                                              |
| Only this computer                           | Run `npm create jant@latest <name>`, then `npm run dev`, and give the person `http://localhost:3000`.                                                                                                                                                |

In a project made by `create-jant`, use its scripts: `npm run deploy`, never `wrangler deploy` directly. The project's `AGENTS.md` lists the rest. With pnpm or Yarn, the scripts are `pnpm run <script>` and `yarn <script>`.

### 4. Hand back what only the person can do

Stop, tell the person exactly what to do and where, and wait for them to say it is done:

- **Signing in to Cloudflare.** Run `npx wrangler login`. It opens a browser where the person approves the sign-in.
- **Enabling R2**, when the deploy says R2 isn't enabled: they open the [R2 dashboard](https://dash.cloudflare.com/?to=/:account/r2) and click **Enable R2**.
- **Choosing a Cloudflare account**, when the deploy lists more than one.
- **API tokens and repository secrets**, such as the ones the GitHub Actions deploy uses.
- **DNS records** at a provider you have no access to.
- **Creating the admin account.** Give the person the site's address. They choose the email and password on the setup screen. If they will use a domain, bind it first: [Before going live](deployment.md#before-going-live) says why.

### 5. Don't

- Don't print, commit, or repeat in the chat an `AUTH_SECRET`, an API token, or a password.
- On a server that already runs something, ask before you stop a service, delete a volume (`docker compose down -v`), or overwrite a `data/` directory or `.env` file.
- Don't change Cloudflare or DNS settings the person didn't ask for. Offer the optional steps at the end instead.

### 6. Finish

The setup is done when the site's address opens the setup screen. Tell the person:

- the address;
- what is left: creating the admin account, and on Cloudflare the steps in [Before going live](deployment.md#before-going-live) they haven't done (custom domain, R2 public access);
- how to update the site later: `npm install @jant/core@latest`, then `npm run deploy` on Cloudflare; `docker compose pull`, then `docker compose up -d` in Docker.

In a new project, remind them to commit the files the setup changed, `wrangler.toml` among them.
