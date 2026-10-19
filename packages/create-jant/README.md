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

# the current directory
npm create jant@latest .

# interactive mode
npm create jant@latest
```

The argument is a directory, and can be a path such as `../sites/blog`. `package.json`, the Worker, the D1 database, and the R2 bucket are named after it: `My Blog` becomes `my-blog`. A directory that already holds files other than `.git`, `.DS_Store`, editor settings, or a `LICENSE` is refused.

## What It Does

The scaffold:

- creates a Cloudflare Workers project wired for Jant
- generates a local `.dev.vars` file with a secure `AUTH_SECRET`
- installs dependencies by default
- with pnpm, pins `packageManager` to the pnpm version that ran it and approves the install scripts of better-sqlite3, esbuild, and workerd in `pnpm-workspace.yaml`
- with Yarn 2 or later, pins `packageManager` to the Yarn version that ran it, installs into `node_modules` instead of Plug'n'Play (`.yarnrc.yml`), and approves the same install scripts in `dependenciesMeta`
- with pnpm or yarn, makes the GitHub Actions deploy workflow install with that package manager instead of npm, through Corepack for Yarn 2 or later
- initializes a git repository by default, unless the directory is already inside one
- can switch the storage template to S3-compatible storage with `--s3`

## Options

```bash
create-jant [directory] [options]

directory      Directory to create the project in, . for the current directory (default: my-jant-site)
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
