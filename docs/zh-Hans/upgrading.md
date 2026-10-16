# 升级

迁移在部署时按顺序执行，所以可以跨版本升级。迁移只能向前：要退回去，只能靠升级前做的备份。

## 升级前

先备份数据库和媒体，见[备份与恢复](backups.md)。还在 0.x 的站点，再看一遍[从 0.x 升级](#从-0x-升级)。

## 升级

### Cloudflare

```bash
npm install @jant/core@latest
```

提交 `package.json` 和 lockfile 并推送到 `main`，或者运行 `npm run deploy`。安装时要带 `@latest`：`npm update` 只在 `package.json` 写的版本范围内升级，到不了新的大版本。

### Docker Compose

```bash
docker compose pull
docker compose up -d
```

`up` 会先执行迁移，再启动站点。

### 不用 Compose 的 Docker

拉取新镜像，用同一个数据目录执行迁移，再用新镜像启动容器：

```bash
docker pull owenyoung/jant:latest
docker run --rm -e AUTH_SECRET=<auth-secret> -v "$(pwd)/data:/var/lib/jant" owenyoung/jant:latest jant migrate
```

### Node

安装新版 `@jant/core`，运行 `jant migrate`，再重启 `jant start`。

### Jant 托管

由服务负责升级。

## 从 0.x 升级

### 所有站点

从 0.11 起，环境变量的值不合法时，站点会在启动时停下。检查这几项：

- `NOINDEX` 这类开关只接受 `true` 或 `false`，不接受 `1` 或 `yes`。
- `RATE_LIMIT_DISABLED=true` 改成 `RATE_LIMIT_ENABLED=false`。
- `SITE_ORIGIN` 只写 origin，如 `https://example.com`。子路径写在 `SITE_PATH_PREFIX`。
- `CORS_ORIGINS` 留空表示关闭跨域访问。想允许所有来源，删掉这一行。

如果你之前只让 Jant Discover 收录精选帖子，升级后这项会关闭。想继续被收录，到 **设置 → 常规** 重新勾选「允许我的博客出现在 Jant Discover 中」。

### Cloudflare 站点

和新版 `@jant/core` 放在同一次提交里，把部署 workflow 和 `AGENTS.md` 换成当前的文件：

```bash
curl -fsSL -o .github/workflows/deploy.yml https://raw.githubusercontent.com/jant-me/jant-starter/main/.github/workflows/deploy.yml
curl -fsSL -o AGENTS.md https://raw.githubusercontent.com/jant-me/jant-starter/main/AGENTS.md
rm -rf .agents/skills .claude/skills
```

这份 workflow 用 npm 安装依赖。用 pnpm 或 Yarn 建的项目，用同一个包管理器新建一个项目，从那里复制。

在 `wrangler.toml` 顶部、第一个 `[section]` 之前加上 `keep_vars = true`。没有这一行，每次部署都会删掉你在 Cloudflare 控制台设置的变量。已经被删掉的，重新设置一次。

### Docker 与 Node

- 站点在反向代理后面时，设置 `TRUST_PROXY=true`，否则所有访客共用一个登录限速。`compose.yml` 已经设置了。
- `jant start` 和 `jant` 命令读取工作目录下的 `.env`。把 `.env.node` 改名成 `.env`。

### 自定义 CSS

| 以前                  | 现在                      |
| --------------------- | ------------------------- |
| `--site-elevated-bg`  | `--site-page-bg`          |
| `--site-nav-hover-bg` | `--site-subtle-bg`        |
| `--search-mark-*`     | `--site-search-mark-*`    |
| `--content-max-width` | `--layout-body-max-width` |
| `--content-gap`       | `--site-feed-rhythm`      |

`data-page` 现在在 `<body>` 上，原来和其他属性连写的选择器要加空格：`[data-page="post"] article[data-post]`。

### 脚本

| 以前                                 | 现在                           |
| ------------------------------------ | ------------------------------ |
| `jant export`                        | `jant db export`               |
| `jant import-site`                   | `jant site import`             |
| `jant site export <url>`             | `jant site export --url <url>` |
| `jant site export --directory <dir>` | `--output <dir>`               |
| `/api/upload/:id`                    | `/api/media/:id`               |
| `GET /api/public/posts`（列表）      | `GET /api/public/threads`      |

`GET /api/search` 需要 API token，`nextCursor` 要原样传回。0.8 到 0.11 的 API 改动，完整列在[发布说明](https://github.com/jant-me/jant/releases)里。
