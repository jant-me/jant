# create-jant

Scaffold a new [Jant](https://github.com/jant-me/jant) site for Cloudflare Workers.

## Usage

```bash
# npm
npm create jant@latest my-site

# pnpm
pnpm create jant@latest my-site

# yarn
yarn create jant my-site

# interactive mode
npm create jant@latest
```

## What It Does

The scaffold:

- creates a Cloudflare Workers project wired for Jant
- generates a local `.dev.vars` file with a secure `AUTH_SECRET`
- installs dependencies by default
- initializes a git repository by default
- can switch the storage template to S3-compatible storage with `--s3`

## Options

```bash
create-jant [project-name] [options]

--s3           Use S3-compatible storage instead of Cloudflare R2
--no-install   Skip dependency installation
--no-git       Skip git initialization
-y, --yes      Skip prompts and use defaults
```

## After Scaffolding

```bash
cd my-site
npm run dev
```

Open `http://localhost:3000`.

Need another local port?

```bash
PORT=3030 npm run dev
```

## What the New Project Includes

- Cloudflare Workers runtime
- D1 for the database
- R2 for media by default
- Drizzle ORM
- better-auth
- Tailwind CSS v4 and BaseCoat
- Lingui for localization
- Jant's CLI commands through the local `jant` binary

## Documentation

- [Getting Started](https://jant.me/docs/getting-started)
- [Deploy on Cloudflare](https://jant.me/docs/deployment)
- [Configuration](https://jant.me/docs/configuration)
- [Theming](https://jant.me/docs/theming)

## License

AGPL-3.0-or-later
