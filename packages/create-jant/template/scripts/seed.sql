-- Seed data for Jant demo site
-- This data will be restored after each daily reset

-- Settings
INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES
  ('siteName', 'Jant Demo', strftime('%s', 'now')),
  ('siteDescription', 'A demo site for Jant - Modern microblog for Cloudflare Workers', strftime('%s', 'now')),
  ('siteUrl', 'https://demo.jant.me', strftime('%s', 'now')),
  ('postsPerPage', '10', strftime('%s', 'now')),
  ('timezone', 'UTC', strftime('%s', 'now')),
  ('language', 'en', strftime('%s', 'now'));

-- Demo posts
INSERT INTO posts (type, visibility, title, content, content_html, published_at, created_at, updated_at) VALUES
  -- Welcome article
  ('article', 'featured', 'Welcome to Jant',
   '# Welcome to Jant Demo

Jant is a modern microblog platform built for Cloudflare Workers. This demo site resets daily at 00:00 UTC.

## Features

- **Multiple post types**: Notes, articles, links, quotes, images, and pages
- **Collections**: Organize posts into collections
- **Full-text search**: Search across all your content
- **Internationalization**: Built-in i18n support
- **Fast**: Edge-deployed on Cloudflare Workers

## Getting Started

```bash
pnpm create jant my-blog
cd my-blog
pnpm install
pnpm dev
```

Visit the [dashboard](/dash) to create your own posts!',
   '<h1>Welcome to Jant Demo</h1>
<p>Jant is a modern microblog platform built for Cloudflare Workers. This demo site resets daily at 00:00 UTC.</p>
<h2>Features</h2>
<ul>
<li><strong>Multiple post types</strong>: Notes, articles, links, quotes, images, and pages</li>
<li><strong>Collections</strong>: Organize posts into collections</li>
<li><strong>Full-text search</strong>: Search across all your content</li>
<li><strong>Internationalization</strong>: Built-in i18n support</li>
<li><strong>Fast</strong>: Edge-deployed on Cloudflare Workers</li>
</ul>
<h2>Getting Started</h2>
<pre><code class="language-bash">pnpm create jant my-blog
cd my-blog
pnpm install
pnpm dev
</code></pre>
<p>Visit the <a href="/dash">dashboard</a> to create your own posts!</p>',
   strftime('%s', 'now'), strftime('%s', 'now'), strftime('%s', 'now')),

  -- A note
  ('note', 'quiet', NULL,
   'This is a demo note. Notes are short posts without titles, perfect for quick thoughts and updates.',
   '<p>This is a demo note. Notes are short posts without titles, perfect for quick thoughts and updates.</p>',
   strftime('%s', 'now') - 3600, strftime('%s', 'now') - 3600, strftime('%s', 'now') - 3600),

  -- A link post
  ('link', 'quiet', 'Jant on GitHub',
   'Check out the source code and documentation for Jant.',
   '<p>Check out the source code and documentation for Jant.</p>',
   strftime('%s', 'now') - 7200, strftime('%s', 'now') - 7200, strftime('%s', 'now') - 7200),

  -- A quote
  ('quote', 'quiet', NULL,
   'The best way to predict the future is to invent it.',
   '<p>The best way to predict the future is to invent it.</p>',
   strftime('%s', 'now') - 10800, strftime('%s', 'now') - 10800, strftime('%s', 'now') - 10800);

-- Update the link post with source info
UPDATE posts SET
  source_url = 'https://github.com/nicepkg/jant',
  source_name = 'GitHub',
  source_domain = 'github.com'
WHERE type = 'link' AND title = 'Jant on GitHub';

-- Update the quote with source info
UPDATE posts SET
  source_name = 'Alan Kay'
WHERE type = 'quote' AND content LIKE '%predict the future%';

-- Demo collection
INSERT INTO collections (path, title, description, created_at, updated_at) VALUES
  ('getting-started', 'Getting Started', 'Resources for getting started with Jant', strftime('%s', 'now'), strftime('%s', 'now'));

-- Add the welcome article to the collection
INSERT INTO post_collections (post_id, collection_id, added_at)
SELECT p.id, c.id, strftime('%s', 'now')
FROM posts p, collections c
WHERE p.title = 'Welcome to Jant' AND c.path = 'getting-started';

-- Update FTS index
INSERT INTO posts_fts (rowid, title, content)
SELECT id, COALESCE(title, ''), COALESCE(content, '') FROM posts WHERE deleted_at IS NULL;
