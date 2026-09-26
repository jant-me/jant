This is a Jant site created with `create-jant`. The application is `@jant/core` in `node_modules`; this project holds its configuration and deployment. `CLAUDE.md` points here.

## Where to look

These come from the installed Jant version, so they stay current after an upgrade:

- **Content**: reading, publishing, editing, organizing, searching, and importing posts through the HTTP API or MCP. Fetch `/skill.md` from the running site, for example `https://your-site.example/skill.md`, or `http://localhost:<port>/skill.md` during `npm run dev`.
- **Command line**: `npx jant --help` lists the commands, and `npx jant <command> --help` lists a command's options.
- **Configuration, deployment, and theming**: https://jant.me/docs

## Project files

- `index.js` is the entry point: `export default createApp()` from `@jant/core`.
- `wrangler.toml` is the Cloudflare deployment and binding config.
- `.dev.vars` holds local secrets such as `AUTH_SECRET`.
- `examples/agent-content-automation/` has sample API requests.

## Rules

- Don't edit `node_modules/@jant/core`. Changes to the product belong in the Jant repository.
- Keep `index.js` a plain `createApp()` wrapper. Customize through site settings, custom CSS, and theme variables.
- Deploy with `npm run deploy`, not `wrangler deploy`: it applies remote migrations and prepares assets first.
- Run `jant` commands from this directory, where `@jant/core` is installed.
