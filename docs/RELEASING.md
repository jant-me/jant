# Releasing Jant

This project uses [Changesets](https://github.com/changesets/changesets) for version management, npm's [Trusted Publishing](https://docs.npmjs.com/generating-provenance-statements) for package releases, and GitHub Actions to publish the official Docker image.

## Versioning (SemVer)

We follow [Semantic Versioning](https://semver.org/):

| Type      | When to use                         | Example           |
| --------- | ----------------------------------- | ----------------- |
| **patch** | Bug fixes, typos                    | `0.0.1` → `0.0.2` |
| **minor** | New features (backwards compatible) | `0.1.0` → `0.2.0` |
| **major** | Breaking changes                    | `0.x.x` → `1.0.0` |

> **Note**: While version is `0.x.x`, a minor release can break things and its changelog carries upgrade notes. From 1.0, [Compatibility](compatibility.md) defines what "breaking" covers: what its first level lists never breaks, and a change to anything its second level lists needs a major release whose changelog carries upgrade notes. A deprecation in a minor release first is optional.
>
> `@jant/core@1.0.0` was published by accident in April 2026 and is deprecated on npm, and npm never accepts a version number twice. The first real 1.x release is **1.0.1**; its changelog says why. A major changeset makes Changesets propose 1.0.0, and `mise run release-version` then moves both packages and their changelog headings to 1.0.1 (`scripts/release/skip-taken-version.mjs`). Keep the `@jant/core@1.0.0` and `create-jant@1.0.0` tags on the remote: they record what the npm 1.0.0 was built from. `create-jant@1.0.0` never reached npm.

## Packages

| Package       | npm                                                                                           | Description          |
| ------------- | --------------------------------------------------------------------------------------------- | -------------------- |
| `@jant/core`  | [![npm](https://img.shields.io/npm/v/@jant/core)](https://www.npmjs.com/package/@jant/core)   | Core framework       |
| `create-jant` | [![npm](https://img.shields.io/npm/v/create-jant)](https://www.npmjs.com/package/create-jant) | CLI scaffolding tool |

## Workflow

### For Contributors

1. **Make changes** in a feature branch
2. **Create a changeset**:
   ```bash
   mise run changeset
   ```
3. **Commit** the changeset file with your changes
4. **Open PR** and merge to main

### For Maintainers

When PRs with changesets are merged:

1. A "Release PR" is automatically created/updated
2. Review the version bumps and changelog. Check that the new version's changelog section is under 125,000 characters:

   ```bash
   git fetch origin changeset-release/main
   git show origin/changeset-release/main:packages/core/CHANGELOG.md | awk '/^## /{n++} n==1' | wc -c
   ```

   After publishing to npm, the Changesets action copies each package's section into a GitHub Release, and GitHub refuses a longer body. The job then stops with npm already holding the version: the `v<version>` release, the Docker image, and the starter sync are skipped, and a rerun finds nothing left to publish, so it doesn't bring them back. If the section is longer, shorten the changesets on `main` before merging.

3. Merge the Release PR
4. Packages are automatically published to npm
5. When `@jant/core` is published, the Release workflow also calls `.github/workflows/docker-publish.yml` to publish `owenyoung/jant:<version>`, `owenyoung/jant:latest`, and from 1.0.1 on `owenyoung/jant:<major>` to Docker Hub
6. The same workflow updates the Docker Hub overview from `docs/docker-hub-overview.md`

   Publishing, the `v<version>` tag, the Docker image, and the starter sync all use the commit CI passed, the merged Release PR. A push to `main` while they run doesn't change what ships.

7. Freeze the release's fixtures, and commit them:

   ```bash
   git fetch --tags
   mise run release-freeze-fixtures <version>
   ```

   This installs `@jant/core@<version>` from npm, loads the canonical demo content at the release tag into a temporary site, adds through that release's API what the demo lacks (a draft, a private post, a text attachment, custom URLs, redirects, a smart collection), and writes the snapshot and site export that release produces into `packages/core/src/__tests__/fixtures/releases/<version>/`. `release-fixtures.test.ts` restores and imports every release there, and checks that the site an export imports into holds what the same release's snapshot holds, so a later change that can no longer read what this release wrote fails in CI. Never edit a frozen fixture. `node scripts/release/freeze-fixtures.mjs --rehearse <dir>` runs the same steps with this checkout's build, to try a change to the script first.

Don't edit the Release PR by hand. Every push to `main` makes the Changesets action rebuild the `changeset-release/main` branch from scratch and force-push it, which throws hand edits away. A change a release needs goes on `main`, and the Release PR picks it up.

## Commands

```bash
# Create a new changeset
mise run changeset

# Check pending changesets
mise run changeset-status

# Apply changesets locally (bump versions)
mise run release-version

# Dry run publish
mise run release-publish-dry

# Publish (usually done by CI)
mise run release-publish
```

## Releasing 1.0.1

The first 1.x release has steps no other release has. Make the first two in one commit on `main`, then merge the Release PR soon after: from that commit on, the docs on `main` say 1.0 has shipped.

- [ ] Add a `major` changeset that introduces the release: what 1.0 promises, with a link to [Compatibility](compatibility.md); why it is 1.0.1 (1.0.0 was published by accident in April 2026); and, for a site upgrading from 0.10 or earlier, a link to 0.11.0's upgrade notes, since the 1.0.1 release notes carry only their own. Changesets then proposes 1.0.0, and `release-version` moves it to 1.0.1 (see [Versioning](#versioning-semver))
- [ ] Retire the pre-1.0 notices, in both languages:
  - the **Pre-1.0** banner at the top of `README.md`, `README.zh-Hans.md`, `docs/overview.md`, and `docs/zh-Hans/overview.md`
  - the "Pre-1.0 — will there be a lot of breaking changes?" entry in `docs/faq.md` and `docs/zh-Hans/faq.md`, which becomes an answer about upgrading within 1.x
  - the "Until then, a minor release can still change what the second level covers" sentence in the first paragraph of `docs/compatibility.md` and `docs/zh-Hans/compatibility.md`
  - the 0.x note under [Versioning](#versioning-semver) on this page
  - the pre-1.0 wording in the first paragraph of `AGENTS.md`: "settling toward 1.0" becomes a statement that 1.0 has shipped, and "until then, adopt the better design directly … with no compatibility shims" goes, leaving the 1.x rule
  - the default bump in `.agents/skills/release/SKILL.md` and `.claude/commands/release.md`, which should say that a breaking change to the second level is `major`
  - the "Still in development" note at the top of `packages/core/README.md`, which npmjs.com shows on the package page until the next release
- [ ] Before merging, check that the Release PR's diff says 1.0.1 in both `package.json` files and both changelogs. Merged at 1.0.0, npm skips `@jant/core`, since 1.0.0 exists, but publishes `create-jant@1.0.0`, whose new projects install the deprecated `@jant/core@1.0.0`
- [ ] After 1.0.1 is on npm, point the accidental 1.0.0's deprecation at it. The message still says to use 0.3.x:

  ```bash
  npm deprecate @jant/core@1.0.0 "Published by accident. Use 1.0.1 or later."
  ```

- [ ] After `owenyoung/jant:1` is on Docker Hub, switch `compose.yml`'s `IMAGE` default, the commented `IMAGE` in `.env.example`, and the images in `docs/deployment-docker.md` (en, zh-Hans) and `docs/docker-hub-overview.md`, from `:latest` to `:1`. Until that tag exists, `compose.yml` on `main` must keep `:latest`: users download it from there. Docker Hub shows the new overview after the next image publish
- [ ] Don't republish 1.0.1 from the **Docker Publish** workflow once `main` has moved on: it builds the version `main` holds, whatever the tag says

## Docker image publishing

The official Docker image lives at `owenyoung/jant`.

- Automatic publish happens after a successful package release that includes `@jant/core`
- The pushed tags are the exact package version, such as `owenyoung/jant:0.3.38`, and `owenyoung/jant:latest`
- From 1.0.1, a release also moves the major tag, such as `owenyoung/jant:1`, to itself. A compose file pinned to it gets every 1.x release and never a 2.0. Pre-releases and 0.x releases don't move it
- If a release's Docker job fails, use **Re-run failed jobs** on that Release run. It builds the release commit again; the arm64 image is built only here, since CI's Docker smoke test is amd64 only, so this is the step most likely to fail first
- Maintainers can manually backfill or republish the current `main` version from the **Docker Publish** workflow using `workflow_dispatch`. It leaves `:latest` and the major tag alone unless you tick **push_latest**, so republishing an older version doesn't move them back
- The workflow also syncs the Docker Hub overview from `docs/docker-hub-overview.md`

### Docker Hub setup

Configure this repository secret before expecting Docker pushes to work:

- `DOCKERHUB_TOKEN`: Docker Hub access token with permission to push that repository

The image name `owenyoung/jant` is part of the [compatibility promise](compatibility.md): users' `compose.yml` files name it. It stays as it is.

If `DOCKERHUB_TOKEN` is missing, package release still works, but the Docker image push and overview sync will fail at the Docker Hub steps.

---

## First-Time Setup (Maintainers Only)

### Step 1: Initial Manual Publish

Packages must exist on npm before configuring Trusted Publishing.

```bash
# Login to npm
npm login

# Publish @jant/core (builds automatically)
mise run release-publish-core

# Publish create-jant
mise run release-publish-create
```

### Step 2: Configure Trusted Publishing on npm

For each package (`@jant/core` and `create-jant`):

1. Go to [npmjs.com](https://npmjs.com) → Your package → **Settings**
2. Find **Trusted Publisher** section
3. Click **GitHub Actions**
4. Fill in:
   - **Repository owner**: `jant-me`
   - **Repository name**: `jant`
   - **Workflow filename**: `release.yml`
   - **Environment**: (leave empty)
5. Click **Set up connection**

Optional: Check "Require two-factor authentication and disallow tokens" for maximum security.

### Step 3: Verify Setup

After configuration, the Release workflow will automatically publish new versions using OIDC authentication. No npm tokens needed!

---

## How Trusted Publishing Works

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Actions                            │
│                                                              │
│  1. Workflow runs with `id-token: write` permission          │
│  2. GitHub generates OIDC token with repo/workflow claims    │
│  3. npm CLI exchanges OIDC token for publish credentials     │
│  4. Package published with provenance attestation            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

Benefits:

- **No secrets to manage** - No npm tokens in GitHub Secrets
- **Provenance** - Each release has cryptographic proof of its build origin
- **Auditable** - Users can verify packages came from the official repo

## Pre-release Versions

For alpha/beta releases:

```bash
# Enter pre-release mode
pnpm changeset pre enter alpha

# Create changesets as normal
pnpm changeset

# Versions will be like: 0.1.0-alpha.0, 0.1.0-alpha.1, etc.

# Exit pre-release mode when ready for stable
pnpm changeset pre exit
```

## Troubleshooting

### "Package not found" when configuring Trusted Publisher

The package must be published at least once before you can configure Trusted Publishing. Do the initial publish manually.

### "OIDC token exchange failed"

- Verify workflow filename matches exactly (including `.yml` extension)
- Check repository owner/name spelling
- Ensure `id-token: write` permission is set in workflow

### Release PR not created

- Check if there are any changeset files in `.changeset/`
- Verify the `GITHUB_TOKEN` has write permissions
