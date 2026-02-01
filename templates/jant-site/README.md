# Jant Site

A personal website/blog powered by [Jant](https://github.com/nicepkg/jant).

## Getting Started

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp _env.example .dev.vars
# Edit .dev.vars with your AUTH_SECRET

# Start development server
pnpm dev
```

Visit http://localhost:9019 to see your site.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm deploy` | Build and deploy to Cloudflare |
| `pnpm preview` | Preview production build |
| `pnpm typecheck` | Run TypeScript checks |

## Customization

### Theme Components

Override theme components by creating files in `src/theme/components/`:

```typescript
// src/theme/components/PostCard.tsx
import type { PostCardProps } from "@jant/core";
import { PostCard as OriginalPostCard } from "@jant/core/theme";

export function PostCard(props: PostCardProps) {
  return (
    <div class="my-wrapper">
      <OriginalPostCard {...props} />
    </div>
  );
}
```

Then register it in `src/index.ts`:

```typescript
import { createApp } from "@jant/core";
import { PostCard } from "./theme/components/PostCard";

export default createApp({
  theme: {
    components: {
      PostCard,
    },
  },
});
```

### Using Third-Party Themes

```bash
pnpm add @jant-themes/minimal
```

```typescript
import { createApp } from "@jant/core";
import { theme as MinimalTheme } from "@jant-themes/minimal";

export default createApp({
  theme: MinimalTheme,
});
```

## Documentation

- [Jant Documentation](https://jant.dev/docs)
- [Architecture Guide](https://github.com/nicepkg/jant/blob/main/docs/internal/architecture.zh-Hans.md)
