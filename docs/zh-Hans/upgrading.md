# 升级

0.3.39（2026 年 3 月）及之后安装的站点，可以原地升级到之后的任何版本，可以跨版本：部署时按顺序执行迁移。迁移只能向前，所以要退回升级前的状态，只能靠升级前做的备份。每种版本可能改动什么，见[兼容性](compatibility.md)。

## 升级前

1. 备份数据库和媒体，各种部署方式的做法见[备份与恢复](backups.md)。
2. 还在 0.x 的站点，照着下面的[从 0.x 升级](#从-0x-升级)逐项检查。

## 升级

### Cloudflare

```bash
npm install @jant/core@latest
```

提交 `package.json` 和 lockfile，推送到 `main`。部署 workflow 会部署新版本并执行迁移，一键部署的站点由 Cloudflare 部署。两者都没有的话，运行 `npm run deploy`。

安装时要带 `@latest`。`npm update` 只在 `package.json` 写的范围内升级，比如 `^0.11.0`，到不了下一个大版本。

`jant deploy` 先执行迁移，再上传新版 Worker，这期间旧 Worker 继续提供服务。发布说明写明某个迁移会替换表时，部署完成前不要在站点上写内容：这段时间里的写入不安全。

### Docker Compose

```bash
docker compose pull
docker compose up -d
```

`up` 会先在 `jant-migrate` 里执行迁移，再启动站点。`.env` 里把 `IMAGE` 固定到某个版本的，先改版本号。

### 不用 Compose 的 Docker

拉取新镜像，用同一个数据目录执行迁移：

```bash
docker pull owenyoung/jant:latest
docker run --rm \
  -e AUTH_SECRET=<auth-secret> \
  -v "$(pwd)/data:/var/lib/jant" \
  owenyoung/jant:latest \
  jant migrate
```

然后停掉并删除旧容器，用[使用 Docker 部署](deployment-docker.md#不用-compose-跑)里的命令从新镜像启动。容器自己不执行迁移。

### Node

安装新版 `@jant/core`，运行 `jant migrate`，再重启 `jant start`。

### Jant 托管

由服务负责升级。

## 从 0.x 升级

每一项写的都是站点在当前版本上应该是什么样子，所以不管从哪个 0.x 版本升上来，照做都对。和你无关的分组可以跳过。

### 先做这几件事

- **用旧版本支持的方式备份。** 0.11 之前，D1 上的 `jant db export --remote` 会失败，改用 D1 Time Travel。Postgres 上用 `pg_dump`：0.11 之前在 Postgres 上做的 `site snapshot`，哪个版本都恢复不了。SQLite 要复制所有 `jant.sqlite*` 文件，不能只复制 `jant.sqlite`。
- **在 0.7.1 上转换旧的文本附件。** 0.3.42（2026 年 4 月）之前加过文本附件、又从没运行过 `jant migrate-text-attachments` 的站点，要先运行它再往上升，因为 0.8.0 删掉了这个命令。安装 `@jant/core@0.7.1` 并部署，在站点和你的 shell 里都设置 `INTERNAL_ADMIN_TOKEN`，运行 `npx jant migrate-text-attachments --url https://<your-site>`，然后再升到最新版本。
- **对照[所有站点](#所有站点)检查环境变量。** 从 0.11 起，设置项不接受的值会让站点在启动时停下。

### 所有站点

| 变量                                                                                                                 | 当前版本的要求                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `AUTH_SECRET`                                                                                                        | 至少 32 个字符，不能含 `replace-me`                                                                                |
| 开关类变量，如 `NOINDEX`、`PUBLIC_API_ENABLED`、`RSS_FEEDS_ENABLED`、`TRUST_PROXY`                                   | `true` 或 `false`。写 `1`、`0`、`yes`、`on` 会让站点停下                                                           |
| `RATE_LIMIT_DISABLED`                                                                                                | 已不再读取。改设 `RATE_LIMIT_ENABLED=false`                                                                        |
| `RATE_LIMIT_SEARCH_PER_MIN`                                                                                          | `0` 表示不限。以前 `0` 当作 30                                                                                     |
| `CORS_ORIGINS`                                                                                                       | 留空表示关闭跨域访问；不设置或写 `*` 表示允许所有来源。带登录 cookie 的跨域写请求，来源必须逐个列出                |
| `STORAGE_DRIVER`                                                                                                     | `r2`、`s3` 或 `local`，小写                                                                                        |
| `DISCOVER`                                                                                                           | `latest` 或 `off`。原来只向 Discover 提供精选帖子的站点，现在是关闭状态；想继续被收录，到 **设置 → 常规** 重新打开 |
| `SITE_ORIGIN`                                                                                                        | 只写协议、主机和端口，如 `https://example.com`。子路径写在 `SITE_PATH_PREFIX`                                      |
| `SITE_LANGUAGE`                                                                                                      | 语言标签，如 `zh-CN`，不是 `zh_CN`                                                                                 |
| `PAGE_SIZE`、`ARCHIVE_PAGE_SIZE`、`RSS_FEED_LIMIT`、`SUMMARY_MAX_CHARS`、`UPLOAD_MAX_FILE_SIZE_MB`、`SLUG_ID_LENGTH` | 在[配置](configuration.md)列出的范围内。`PAGE_SIZE` 默认是 25，想要原来的每页数量就设成 `50`                       |
| `DEV_API_TOKEN`                                                                                                      | 生产环境不设置，它只用于本地调试                                                                                   |

数据回填和迁移一起执行，`jant deploy` 和 Docker Compose 都会跑。如果你的部署自己调用 `wrangler deploy` 或 `wrangler d1 migrations apply`，运行一次 `jant migrate`（Cloudflare 上是 `npx jant migrate --remote`）。

### Cloudflare 站点

这些改动和新版 `@jant/core` 放在同一次提交里。

- **`.github/workflows/deploy.yml`**：整份换成当前的文件。旧文件要么每次都跳过部署，要么部署时漏掉数据回填：

  ```bash
  curl -fsSL -o .github/workflows/deploy.yml https://raw.githubusercontent.com/jant-me/jant-starter/main/.github/workflows/deploy.yml
  ```

  这份文件用 npm 安装依赖。用 pnpm 或 Yarn 建的项目，用同一个包管理器新建一个项目，比如 `pnpm create jant jant-new`，再复制它的 `.github/workflows/deploy.yml`。

- **`wrangler.toml`**：在顶层、第一个 `[section]` 之前写 `keep_vars = true`。没有这一行，每次部署都会删掉你在 Cloudflare 控制台设置的变量。检查 `R2_PUBLIC_URL` 和 `IMAGE_TRANSFORM_URL` 还在不在，不在就重新设置，或者写进 `[vars]`。
- **`package.json`**：脚本和新项目一样，是 `dev`、`deploy`、`reset-password`。删掉 `export` 脚本，改用 `npx jant db export`。`tailwindcss` 也可以删。
- **`AGENTS.md`**：换成当前的文件，并删掉 `.agents/skills/` 和 `.claude/skills/`：

  ```bash
  curl -fsSL -o AGENTS.md https://raw.githubusercontent.com/jant-me/jant-starter/main/AGENTS.md
  rm -rf .agents/skills .claude/skills
  ```

### Docker 与 Node

- **`compose.yml`**：换成当前的文件。2026 年 4 月之前的版本，`docker compose up` 从来不执行迁移：

  ```bash
  curl -O https://raw.githubusercontent.com/jant-me/jant/main/compose.yml
  ```

- **`TRUST_PROXY=true`**：站点在反向代理后面时要设置，否则所有访客共用一个登录限速。`compose.yml` 已经设置了；用 `docker run` 的要自己传。
- **`.env`**：`jant start` 和 `jant` 命令读取工作目录下的 `.env`。把 `.env.node` 改名成 `.env`，或者设置 `JANT_ENV_FILE=.env.node`。以前 `jant start` 不读 `.env`，所以先看看里面写了什么。
- **健康检查**：用 `/healthz` 和 `/readyz`。`/health` 已经没有了。
- **`@jant/core/node`** 已经删除，用 `jant start` 启动服务。

### API 客户端

| 以前                                                                                       | 现在                                                                                               |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `GET /api/upload`，以及 `GET`、`PATCH`、`DELETE /api/upload/:id`                           | `GET /api/media`，以及 `GET`、`PUT`、`DELETE /api/media/:id`                                       |
| `PATCH /api/media/:id`                                                                     | `PUT /api/media/:id`                                                                               |
| `GET /api/posts/:id/content`                                                               | `GET /api/posts/:id?content=markdown`，读 `bodyMarkdown`                                           |
| `GET /api/public/posts`（列表）                                                            | `GET /api/public/threads`。`GET /api/public/posts/:slug` 保留                                      |
| `GET /api/public/archive`                                                                  | `GET /api/public/threads?visibility=any&sort=published`                                            |
| `/api/upload/multipart`                                                                    | `/api/uploads` 上传会话，或者一次 `POST /api/upload`                                               |
| `POST /api/collections/:id/posts`（`postId`）、`DELETE /api/collections/:id/posts/:postId` | `POST /api/collections/:id/threads`（`threadId`）、`DELETE /api/collections/:id/threads/:threadId` |
| `/api/collections/sidebar-items`                                                           | `/api/collections/directory-items`                                                                 |
| `POST /api/export/zola`                                                                    | `POST /api/export/hugo`                                                                            |
| 发给 `PUT /api/settings/import` 的外观设置                                                 | `PUT /api/settings`                                                                                |

- **登录**：`GET /api/search`、`GET /api/collections`、`GET /api/collections/:id`、`GET /api/nav-items` 需要登录会话或 API token。搜索结果包含私密帖子；读者用 `/search` 页面搜索。
- **翻页**：`nextCursor` 原样传回。把帖子 ID 或媒体 ID 当作 `cursor` 会返回 `400`。`GET /api/custom-urls` 用 `limit` 和 `cursor` 翻页，返回 `{ customUrls, nextCursor }`。
- **排序**：`GET /api/posts` 按 `publishedAt` 从新到旧排列，置顶帖子不再排在最前。
- **错误**：`{ error, code }`，校验错误另带 `details`。按 `code` 判断。
- **删掉的字段**：所有资源的 `siteId`；帖子的 `previewImageKey`、`previewKind`、`previewProvider`、`translationGroupId`；媒体的 `filename`（改读 `originalName`）、`provider`、`position`（改看帖子 `attachments` 的顺序）。
- **上传**：`POST /api/upload` 和 `POST /api/uploads/:id/complete` 返回 `201` 和媒体对象。已经挂在另一篇帖子上的 `mediaId` 返回 `409`，第二篇帖子要重新上传文件。
- **取值**：`pinnedAt`、`featuredAt` 只接受 Unix 秒数或 `null`，`rating` 只接受数字。`PUT /api/posts/:id` 拒绝帖子格式不用的字段，比如笔记上的 `url`。
- **智能合集**：`sort` 改成 `sortOrder`；读取或写入单个智能合集时直接返回对象本身，不再包一层 `{ smartCollection }`。
- **自定义 URL**：`path` 以 `/` 开头，`redirectType` 是数字。
- **公开帖子里的文本附件**：文件地址在 `url`，`contentUrl` 已经删掉。
- **设置**：`DELETE /api/settings/:key` 返回和 `GET /api/settings` 一样的结构，`PUT /api/settings/import` 返回 `{ settings, rejectedKeys }`。

API 会忽略不认识的请求字段，不会报错，所以要检查返回结果，不能等它报错。

### MCP 客户端

| 以前                                                                    | 现在                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `jant_search_posts`（参数 `query`）                                     | `jant_posts_search`（参数 `q`）                                               |
| `jant_media_update_alt`                                                 | `jant_media_update`                                                           |
| `jant_posts_get_content`                                                | `jant_posts_get` 加 `content: "markdown"`，读 `bodyMarkdown`                  |
| `jant_collections_add_post`、`jant_collections_remove_post`（`postId`） | `jant_collections_add_thread`、`jant_collections_remove_thread`（`threadId`） |

调用失败时，`structuredContent` 是 `{ error, code, details }`。cursor、`mediaId` 和数字字段的规则与上面的 API 相同。

### 自定义 CSS

| 以前                                               | 现在                                                |
| -------------------------------------------------- | --------------------------------------------------- |
| `--site-elevated-bg`                               | `--site-page-bg`                                    |
| `--site-nav-hover-bg`                              | `--site-subtle-bg`                                  |
| `--search-mark-bg`、`--search-mark-color`          | `--site-search-mark-bg`、`--site-search-mark-color` |
| 用于链接的 `--site-accent`                         | `--site-content-link`                               |
| 用于帖子正文的 `--foreground`                      | `--site-reading-body`                               |
| `--site-width`、`--content-max-width`              | `--layout-body-max-width`                           |
| 帖子之间间距用的 `--site-padding`、`--content-gap` | `--site-feed-rhythm`                                |

`--card-radius`、`--card-padding`、`--card-border-width`、`--card-shadow`、`--site-accent-text`、`--fw-light`、`--fw-extrabold` 已经删除，读取它们的 `var()` 会用回退值。

- **深色模式**：覆盖写在 `:root[data-theme-mode="dark"]` 下，或者写在 `@media (prefers-color-scheme: dark)` 里的 `:root:not([data-theme-mode="light"])` 下。自定义 CSS 里普通的 `:root` 规则就能覆盖主题，不需要 `:root:root`。
- **`data-page`** 在 `<body>` 上。原来和其他属性连写的选择器要加空格：`[data-page="post"] article[data-post]`。
- **引用**：被引用的文字是 `[data-post-quote]`。嵌套的 `[data-post-media] [data-post-media]` 现在是 `[data-post-media]`。

所有变量和属性见[主题定制](theming.md)。

### 导出与 Hugo 模板

- 合集页面的 `.Params.summary_text` 改成 `.Params.description`。
- 媒体条目用 `src` 和 `poster`，`provider`、`storage_key`、`poster_key` 已经删掉。
- 自己 `layouts/` 里复制过 `featured-thread.html` 的，换成主题当前的版本：折叠处会链接到第一篇隐藏的帖子。
- 0.11 及之后的导出不能导入 0.10 或更早的版本。先升级接收导入的站点。
- `jant site import` 默认读取 `jant-site-export.zip`。导入目录要加 `--path <dir>`。
- 0.7.0 之前的导出不一定能导入。升级后重新导出一次。

### 地址

- 有多个自定义 URL 的帖子或合集，地址是最早的那个。想换成较新的，删掉较早的。
- 第一段以 `_` 或 `.` 开头的自定义 URL 会返回 `404`。给帖子加一个新的自定义 URL，再删掉旧的。
- 指向其他站点的重定向，升级后会补回 `//`，但仍是小写。大小写有意义的，重新编辑一次。

### 命令行

| 以前                                               | 现在                                      |
| -------------------------------------------------- | ----------------------------------------- |
| `jant export`                                      | `jant db export`                          |
| `jant import-site`                                 | `jant site import`                        |
| `jant search-reindex`                              | `jant search reindex`                     |
| `jant site localize-media`                         | `jant site pull-media`                    |
| `jant site export <url>`、`jant site import <url>` | `--url <url>`                             |
| `jant site export --directory <dir>`               | `--output <dir>`                          |
| `jant telegram register-webhooks --base-url`       | `--url`                                   |
| `jant deploy --site-path-prefix`                   | `--path-prefix`                           |
| `jant --remote migrate`                            | `jant migrate --remote`：选项写在命令后面 |
| 只跑一批的 `jant uploads cleanup`                  | `jant uploads cleanup --once`             |

所有命令和选项见[命令行](cli.md)。

## 发布说明

每个版本的发布说明在 [GitHub](https://github.com/jant-me/jant/releases) 上：`@jant/core@<version>` 那一条是完整内容，`v<version>` 那一条只有一个链接。需要你做点什么的改动，会带一段 **Upgrade notes**。从 1.0 起，[兼容性](compatibility.md)承诺范围内的改动只在大版本里出现，这一页会在发版前把它的升级说明整理好。
