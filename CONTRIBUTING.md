# Contributing to Jant

Thanks for your interest in contributing to Jant.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/your-org/jant.git
cd jant

# Install dependencies
pnpm install

# Start development
mise run dev
```

## Project Structure

```
jant/
├── packages/
│   ├── core/           # @jant/core - Main package
│   └── cli/            # @jant/cli - CLI tool
├── templates/          # Project templates
└── docs/               # Documentation
```

## Commands

All commands are defined in `mise.toml`:

```bash
mise run dev          # Start dev server
mise run db:generate  # Generate migrations
mise run db:migrate   # Apply migrations
mise run lint         # Run linter
mise run typecheck    # Run type checker
mise run deploy       # Deploy to Cloudflare
```

## Architecture Principles

1. **Single file, single responsibility**: Keep files under 300 lines
2. **Explicit dependencies**: Pass via parameters, avoid global state
3. **Types as documentation**: Full TypeScript types + Zod validation
4. **Convention over configuration**: Follow the established patterns

## Code Style

- Use TypeScript
- All comments and documentation in English
- Use BaseCoat classes for UI components
- Use Tailwind only for layout (flex, grid, spacing)

## Pull Requests

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `mise run lint && mise run typecheck`
5. Commit with a clear message
6. Open a PR

## Internal Documentation

For deeper technical details, see:
- [docs/internal/plan.md](docs/internal/plan.md) - Product design
- [docs/internal/agent.md](docs/internal/agent.md) - Technical spec
- [docs/internal/decisions.md](docs/internal/decisions.md) - Design decisions
