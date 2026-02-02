# Releasing Jant Packages

This project uses [Changesets](https://github.com/changesets/changesets) for version management and npm's [Trusted Publishing](https://docs.npmjs.com/generating-provenance-statements) for secure automated releases.

## Versioning (SemVer)

We follow [Semantic Versioning](https://semver.org/):

| Type | When to use | Example |
|------|-------------|---------|
| **patch** | Bug fixes, typos | `0.0.1` → `0.0.2` |
| **minor** | New features (backwards compatible) | `0.1.0` → `0.2.0` |
| **major** | Breaking changes | `0.x.x` → `1.0.0` |

> **Note**: While version is `0.x.x`, the API is considered unstable. Breaking changes may occur in minor versions.

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `@jant/core` | [![npm](https://img.shields.io/npm/v/@jant/core)](https://www.npmjs.com/package/@jant/core) | Core framework |
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

## Commands

```bash
# Create a new changeset
mise run changeset

# Check pending changesets
mise run cs:status

# Apply changesets locally (bump versions)
mise run version

# Dry run publish
mise run release:dry

# Publish (usually done by CI)
mise run release
```

---

## First-Time Setup (Maintainers Only)

### Step 1: Initial Manual Publish

Packages must exist on npm before configuring Trusted Publishing.

```bash
# Login to npm
npm login

# Publish @jant/core (builds automatically)
mise run publish:core

# Publish create-jant
mise run publish:create
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
