# Contributing to Jant

Thanks for your interest in contributing to Jant! This guide will help you get started.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) >= 24.0.0 (LTS)
- [pnpm](https://pnpm.io/) 10.x
- [mise](https://mise.jdx.dev/) (recommended for running tasks)

### Getting Started

```bash
# Clone the repo
git clone https://github.com/jant-me/jant.git
cd jant

# Install dependencies
pnpm install

# Start development server
mise run dev
```

The dev server runs at http://localhost:9019

### Environment Setup

Create `.dev.vars` in `packages/core/`:

```
AUTH_SECRET=your-secret-at-least-32-chars
```

## Project Structure

```
jant/
├── packages/
│   ├── core/              # @jant/core - Main framework
│   └── create-jant/       # create-jant - CLI scaffolding tool
├── templates/
│   └── jant-site/         # Reference template
├── docs/                  # Documentation
└── .changeset/            # Changesets for versioning
```

### Packages

| Package       | Description                                 |
| ------------- | ------------------------------------------- |
| `@jant/core`  | Core microblogging framework (Hono, D1, R2) |
| `create-jant` | CLI tool for creating new Jant projects     |

## Development Workflow

### Common Commands

```bash
# Development
mise run dev              # Start dev server (port 9019)
mise run dev-debug        # Start on port 19019 (for debugging)

# Code Quality
mise run lint             # Run ESLint
mise run typecheck        # Run TypeScript checks
mise run format           # Format with Prettier

# Database
mise run db-generate      # Generate Drizzle migrations
mise run db-migrate       # Apply migrations locally

# i18n
mise run i18n             # Extract + translate + compile
mise run i18n-extract     # Extract messages only

# Build
mise run build            # Build project
mise run deploy           # Deploy to Cloudflare
```

### Making Changes

1. **Create a branch:**

   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes**

3. **Run checks:**

   ```bash
   mise run lint && mise run typecheck
   ```

4. **Create a changeset** (if your changes affect published packages):

   ```bash
   mise run changeset
   ```

5. **Commit and push:**
   ```bash
   git add .
   git commit -m "feat: add my feature"
   git push origin feat/my-feature
   ```

## Code Style

### General Principles

- **TypeScript**: Full type coverage, no `any`
- **Simple over clever**: Prefer readable code
- **Single responsibility**: Keep files focused
- **Explicit dependencies**: Pass via parameters, avoid globals

### Naming Conventions

- Routes: `xxxRoutes` (e.g., `postsRoutes`)
- Services: `xxxService` functions
- Components: PascalCase (e.g., `PostList`)

### UI Guidelines

- Use [BaseCoat](https://basecoat.dev) classes for components
- Use Tailwind only for layout (flex, grid, spacing)
- All user-facing strings must use i18n `t()` function

### Documentation

- JSDoc comments for utility functions
- Include `@param`, `@returns`, `@example`
- Comments in English

## Pull Request Process

### Before Submitting

1. Run all checks:

   ```bash
   mise run lint && mise run typecheck
   ```

2. If changing published packages, add a changeset:

   ```bash
   mise run changeset
   ```

3. Update documentation if needed

### PR Guidelines

- Use clear, descriptive titles
- Reference related issues
- Include screenshots for UI changes
- Keep PRs focused on a single concern

### CI Checks

All PRs must pass:

- ESLint (no errors)
- TypeScript (no errors)
- Build (successful)

### Review Process

1. Submit PR to `main` branch
2. Wait for CI checks to pass
3. Address review feedback
4. Merge when approved

## Release Process

We use [Changesets](https://github.com/changesets/changesets) for version management.

### Creating a Changeset

After making changes that should be released:

```bash
mise run changeset
```

This will prompt you to:

1. Select changed packages
2. Choose bump type (major/minor/patch)
3. Write a change summary

### Version Types (SemVer)

| Type    | When to use                         | Example           |
| ------- | ----------------------------------- | ----------------- |
| `patch` | Bug fixes, typos                    | `1.0.0` → `1.0.1` |
| `minor` | New features (backwards compatible) | `1.0.0` → `1.1.0` |
| `major` | Breaking changes                    | `1.0.0` → `2.0.0` |

### Release Workflow

```
┌─────────────────┐
│  Make changes   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Run changeset   │  ← mise run changeset
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Open PR       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  CI runs checks │  ← lint, typecheck, build
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Merge to main  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Release PR      │  ← Auto-created by bot
│ created/updated │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Merge Release   │
│      PR         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Published to    │  ← Automatic
│     npm         │
└─────────────────┘
```

### Checking Release Status

```bash
# See pending changesets
mise run cs:status

# Dry run publish (no actual publish)
mise run release:dry
```

For detailed release documentation, see [docs/RELEASING.md](docs/RELEASING.md).

## Getting Help

- [GitHub Issues](https://github.com/jant-me/jant/issues) - Bug reports & feature requests
- [Documentation](https://jant.me/docs) - Guides and API reference

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 License.
