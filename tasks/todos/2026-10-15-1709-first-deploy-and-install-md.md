# First deploy in one command, and an install page for coding agents

A project made by `npm create jant` can't deploy without five manual steps, and
create-jant's closing note never mentions deploying. Make `npm run deploy`
work on the first run, say so in the outro, and give coding agents one page to
start from: `https://jant.me/docs/install.md`.

## `jant deploy` first-run setup

Runs when the D1 binding's `database_id` is `"local"` (the scaffold placeholder)
or missing. Every step finds before it creates, so a rerun changes nothing.

- [x] Sign-in: `wrangler whoami --json`. Not signed in: in a terminal run
      `wrangler login`; otherwise fail with "run `npx wrangler login`, or set
      `CLOUDFLARE_API_TOKEN`".
- [x] Account: more than one and no `account_id`/`CLOUDFLARE_ACCOUNT_ID`: in a
      terminal ask which one and write `account_id` to `wrangler.toml`;
      otherwise fail listing the accounts.
- [x] D1: find `database_name` in `wrangler d1 list --json`, else
      `wrangler d1 create`; write its ID into `wrangler.toml`, keeping comments.
- [x] R2: every `[[r2_buckets]]` entry: `r2 bucket info`, else `r2 bucket
      create`. R2 not enabled → say where to enable it.
- [x] `AUTH_SECRET`: `wrangler secret list`; when missing, generate one and pass
      it with `wrangler deploy --secrets-file` (temp file, 0600, removed after).
      Never printed, never overwritten.
- [x] After a first deploy: say to commit `wrangler.toml`, and point at
      "Before going live".
- [x] `--help` text, `docs/cli.md` + `docs/zh-Hans/cli.md`.
- [x] Tests: setup decisions with wrangler stubbed, `wrangler.toml` rewrite.

## create-jant

- [x] Outro: `npm run dev` and `npm run deploy` with a line each, plus the
      deploy guide link.
- [x] Copy: drop "Project created successfully!" and "Happy coding!".
- [x] Template deploy workflow: header and skip message say to run
      `npm run deploy` once and commit `wrangler.toml`.

## install.md and entry points

- [x] `docs/install.md`, written for the agent: detect, ask once with defaults,
      route to deployment / deployment-docker / hosted / local clone, hand-off
      points, never-do list, done criteria.
- [x] `docs/SUMMARY.md` entry.
- [ ] Prompt in `docs/getting-started.md` (+ zh-Hans), top of
      `docs/deployment.md` and `docs/deployment-docker.md` (+ zh-Hans).
- [ ] `docs/deployment.md` (+ zh-Hans): local-first deploy shrinks to
      `npm run deploy`; GitHub Actions section says deploy once locally first.
- [ ] Template `README.md`: Option B and "Develop locally" (agent prompt).
- [x] Template `AGENTS.md`: deployment points at install.md.
- [ ] Changeset with upgrade notes.

## Verify

- [ ] `mise run check-tests`, `mise run check-lint`, `mise run check-copy`.
- [ ] Real first deploy of a scaffolded project with the local CLI, rerun is a
      no-op, then delete the test Worker, D1 and R2.
- [ ] Agents: Claude Code and Codex on the install prompt — asks before acting,
      stops at hand-offs; one run through to a deploy.

## Results

Done so far: setup module `bin/lib/cloudflare-setup.js` + deploy wiring, 17 new
tests passing (`cli-deploy`, `cli-deploy-setup`, `cli-commands`); outro (also
fixes `pnpm deploy` → `pnpm run deploy`); workflow; install.md; getting-started
(+ zh-Hans); English deployment.md.

Left: zh-Hans deployment.md (mirror the English deploy section, AI pointer, CI
note, common error, prerequisites), pointer in deployment-docker.md (+ zh-Hans),
template README Option B + Develop locally prompt, changeset, full checks,
real deploy test, agent runs.
