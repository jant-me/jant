# 升级

## 升级前

先备份数据库和媒体，见[备份与恢复](backups.md)。还在 0.x 的站点，先看[从 0.x 升级](#从-0x-升级)。

## 升级

### Cloudflare

```bash
npm install @jant/core@latest
```

提交 `package.json` 和 lockfile 并推送到 `main`，或者运行 `npm run deploy`。

### Docker Compose

```bash
docker compose pull
docker compose up -d
```

### 不用 Compose 的 Docker

拉取新镜像并执行迁移，再用新镜像启动容器：

```bash
docker pull owenyoung/jant:1
docker run --rm -e AUTH_SECRET=<auth-secret> -v "$(pwd)/data:/var/lib/jant" owenyoung/jant:1 jant migrate
```

### Node

安装新版 `@jant/core`，运行 `jant migrate`，再重启 `jant start`。

### Jant 托管

由服务负责升级。

## 从 0.x 升级

### 所有站点

检查这几个环境变量：

- `NOINDEX` 这类开关只接受 `true` 或 `false`，不接受 `1` 或 `yes`。
- `RATE_LIMIT_DISABLED=true` 改成 `RATE_LIMIT_ENABLED=false`。
- `SITE_ORIGIN` 只写 origin，如 `https://example.com`。子路径写在 `SITE_PATH_PREFIX`。
- `CORS_ORIGINS` 留空表示关闭跨域访问。想允许所有来源，删掉这一行。

如果你之前只让 Jant Discover 收录精选帖子，升级后这项会关闭。想继续被收录，到 **设置 → 常规** 重新勾选「允许我的博客出现在 Jant Discover 中」。

地址是 `/subscribe` 的帖子，升级后这个地址归订阅页。

### Cloudflare 站点

和新版 `@jant/core` 放在同一次提交里，把部署 workflow 和 `AGENTS.md` 换成当前的文件：

```bash
curl -fsSL -o .github/workflows/deploy.yml https://raw.githubusercontent.com/jant-me/jant-starter/main/.github/workflows/deploy.yml
curl -fsSL -o AGENTS.md https://raw.githubusercontent.com/jant-me/jant-starter/main/AGENTS.md
rm -rf .agents/skills .claude/skills
```

用 pnpm 或 Yarn 的项目，从用同一个包管理器新建的项目里复制 workflow。

在 `wrangler.toml` 顶部、第一个 `[section]` 之前加上 `keep_vars = true`，再检查你在 Cloudflare 控制台设置的变量还在不在。

### Docker 与 Node

- 不用 Compose、站点又在反向代理后面时，设置 `TRUST_PROXY=true`。
- 把 `.env.node` 改名成 `.env`。

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
