# Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for version management.

## Quick Start

After making changes, run:

```bash
mise run changeset
```

This will guide you through:

1. Selecting changed packages
2. Choosing version bump type (major/minor/patch)
3. Writing a change summary

## Guidelines

- **patch**: Bug fixes, typos, minor improvements
- **minor**: New features, enhancements (backwards compatible)
- **major**: Breaking changes (API changes, removed features)

## Examples

Good changeset summaries:

- "Add dark mode support to dashboard"
- "Fix image upload failing on large files"
- "BREAKING: Remove deprecated `Post.slug` field"

For more details, see [docs/RELEASING.md](../docs/RELEASING.md).
