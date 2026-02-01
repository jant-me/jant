# Jant Site

A personal website/blog powered by [Jant](https://github.com/nicepkg/jant).

## Getting Started

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .dev.vars.example .dev.vars
# Edit .dev.vars and set AUTH_SECRET (32+ random characters)

# Start development server
pnpm dev
```

Visit http://localhost:9019 to see your site.

## Deploy to Cloudflare

### 1. Create Cloudflare Resources

First, make sure you have [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed and logged in:

```bash
# Install wrangler if not already installed
npm install -g wrangler

# Login to Cloudflare
wrangler login
```

Create the required resources:

```bash
# Create D1 database
wrangler d1 create my-blog-db
# Note the database_id from the output!

# Create R2 bucket for media storage
wrangler r2 bucket create my-blog-media
```

### 2. Update Configuration

Edit `wrangler.toml` with your resource IDs:

```toml
name = "my-blog"  # Your worker name

[[d1_databases]]
binding = "DB"
database_name = "my-blog-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # From step 1

[[r2_buckets]]
binding = "R2"
bucket_name = "my-blog-media"
```

### 3. Set Secrets

```bash
# Set authentication secret (use a random 32+ character string)
wrangler secret put AUTH_SECRET
# Enter your secret when prompted
```

### 4. Run Migrations

```bash
# Apply database migrations
wrangler d1 migrations apply my-blog-db --remote
```

### 5. Deploy

```bash
# Build and deploy
pnpm deploy
```

Your site is now live at `https://my-blog.<your-subdomain>.workers.dev`!

### 6. GitHub Actions (CI/CD)

A workflow file is already included at `.github/workflows/deploy.yml`. You just need to configure secrets.

#### Create API Token

1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token**
3. Click **Use template** next to **Edit Cloudflare Workers**
4. **IMPORTANT: Add D1 permission** (not included in template by default):
   - Click **+ Add more**
   - Select: **Account** → **D1** → **Edit**

5. Your permissions should include at minimum:

| Scope | Permission | Access |
|-------|------------|--------|
| Account | Workers Scripts | Edit |
| Account | Workers R2 Storage | Edit |
| Account | **D1** | **Edit** ← Must add manually! |
| Zone | Workers Routes | Edit |

6. **Account Resources** (below permissions list):
   - Select **Include** → **Specific account** → Choose your account

7. **Zone Resources**:
   - Select **Include** → **All zones from an account** → Choose your account

8. Click **Continue to summary** → **Create Token**
9. Copy the token (you won't see it again!)

#### Add GitHub Secrets

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret Name | Value |
|-------------|-------|
| `CF_API_TOKEN` | Your API token from above |
| `CF_ACCOUNT_ID` | Your Cloudflare Account ID (find it in dashboard URL or `wrangler whoami`) |
| `AUTH_SECRET` | Random 32+ character string for authentication |

That's it! Push to `main` branch to trigger deployment.

#### Using Environments (Optional)

If you want separate staging/production environments, update `.github/workflows/deploy.yml`:

```yaml
jobs:
  deploy:
    uses: nicepkg/jant/.github/workflows/deploy.yml@v1
    with:
      environment: production  # Uses [env.production] in wrangler.toml
    secrets:
      CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
      CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
      AUTH_SECRET: ${{ secrets.AUTH_SECRET }}
```

### 7. Custom Domain (Optional)

To use your own domain:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) > Workers & Pages
2. Select your worker > Settings > Triggers
3. Click "Add Custom Domain"
4. Enter your domain (e.g., `blog.example.com`)

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm deploy` | Build and deploy to Cloudflare |
| `pnpm preview` | Preview production build |
| `pnpm typecheck` | Run TypeScript checks |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AUTH_SECRET` | Secret key for authentication (32+ chars) | Yes |
| `SITE_URL` | Your site's public URL | Set in wrangler.toml |

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

### Custom Styles

Add custom CSS in `src/theme/styles/`:

```css
/* src/theme/styles/custom.css */
@import "@jant/core/theme/styles/main.css";

/* Your custom styles */
.my-custom-class {
  /* ... */
}
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

## Updating

To update Jant to the latest version:

```bash
pnpm update @jant/core
```

## Documentation

- [Jant Documentation](https://jant.me/docs)
- [GitHub Repository](https://github.com/nicepkg/jant)
