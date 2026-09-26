# Releasing Jant

This project uses [Changesets](https://github.com/changesets/changesets) for version management, npm's [Trusted Publishing](https://docs.npmjs.com/generating-provenance-statements) for package releases, and GitHub Actions to publish the official Docker image.

## Versioning (SemVer)

We follow [Semantic Versioning](https://semver.org/):

| Type      | When to use                         | Example           |
| --------- | ----------------------------------- | ----------------- |
| **patch** | Bug fixes, typos                    | `0.0.1` → `0.0.2` |
| **minor** | New features (backwards compatible) | `0.1.0` → `0.2.0` |
| **major** | Breaking changes                    | `0.x.x` → `1.0.0` |

> **Note**: While version is `0.x.x`, the API is considered unstable. Breaking changes may occur in minor versions.

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
2. Review the version bumps and changelog
3. Merge the Release PR
4. Packages are automatically published to npm
5. When `@jant/core` is published, the Release workflow also calls `.github/workflows/docker-publish.yml` to publish `owenyoung/jant:<version>` and `owenyoung/jant:latest` to Docker Hub
6. The same workflow updates the Docker Hub overview from `docs/docker-hub-overview.md`
7. Freeze the release's fixtures, and commit them:

   ```bash
   git fetch --tags
   mise run release-freeze-fixtures <version>
   ```

   This copies the canonical demo snapshot and site export at the release tag into `packages/core/src/__tests__/fixtures/releases/<version>/`. `release-fixtures.test.ts` restores and imports every release there, so a later change that can no longer read what this release wrote fails in CI. Never edit a frozen fixture.

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

## Docker image publishing

The official Docker image lives at `owenyoung/jant`.

- Automatic publish happens after a successful package release that includes `@jant/core`
- The pushed tags are the exact package version, such as `owenyoung/jant:0.3.38`, and `owenyoung/jant:latest`
- Maintainers can manually backfill or republish the current `main` version from the **Docker Publish** workflow using `workflow_dispatch`
- The workflow also syncs the Docker Hub overview from `docs/docker-hub-overview.md`

### Docker Hub setup

Configure this repository secret before expecting Docker pushes to work:

- `DOCKERHUB_TOKEN`: Docker Hub access token with permission to push that repository

The workflow hardcodes the Docker Hub owner as `owenyoung`. If ownership moves later, update `.github/workflows/docker-publish.yml` in the same change.

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
