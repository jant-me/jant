# 配置

Jant 的配置来自两个地方：

- **环境变量**：控制基础设施和运行时行为
- **设置页面**：站点名称、外观、时区等可在线调整的选项

大多数单站点安装只需要设置一个值：`AUTH_SECRET`，其余按需配置。

## 环境变量

使用：

- `wrangler.toml` 存放 Cloudflare 的非敏感配置
- `.dev.vars` 存放本地 Cloudflare secrets
- `.env` 或进程环境变量，供 Node 和 Docker 使用

### 必需项

所有运行时都必须设置这个变量：

| 变量          | 说明                                                                         |
| ------------- | ---------------------------------------------------------------------------- |
| `AUTH_SECRET` | better-auth 用于签名 session cookie 的密钥，至少 32 个字符。不要提交进版本库 |

- Cloudflare 本地开发：放进 `.dev.vars`
- Cloudflare 生产环境：用 `npx wrangler secret put AUTH_SECRET` 作为 Worker secret 设置
- Node 和 Docker：放进 `.env` 或进程环境变量

### 公开 URL 和子路径

大多数情况下，这两个变量都不需要设置。Jant 默认从请求的 host 自动推导 origin，并挂载在根路径下。

| 变量               | 说明                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `SITE_ORIGIN`      | 固定公开 origin，例如 `https://example.com`。影响 RSS、sitemap、export、auth callbacks 等生成的绝对 URL |
| `SITE_PATH_PREFIX` | 公开路径前缀，例如 `/blog`。影响所有路由和静态资源路径                                                  |

只有在以下情况才需要设置：

- **站点在反向代理后面，而代理没有正确传递 Host，推导出的 origin 不对**：设置 `SITE_ORIGIN=https://example.com`
- **挂在子路径下**（例如 `example.com/blog`）：设置 `SITE_PATH_PREFIX=/blog`
- **需要写死域名**

### Node 和 Docker

在 Node 和 Docker 下，Jant 通过 `DATABASE_URL` 判断数据库运行时：

- `file:` 表示 SQLite
- `postgres:` 或 `postgresql:` 表示 Postgres

最小 SQLite 示例：

```env
AUTH_SECRET=your-32-plus-character-secret
SITE_ORIGIN=https://your-jant.example
DATABASE_URL=file:./data/jant.sqlite
```

最小 Postgres 示例：

```env
AUTH_SECRET=your-32-plus-character-secret
SITE_ORIGIN=https://your-jant.example
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
```

Node 和 Docker 的常用变量：

| 变量                 | 默认值                   | 说明                                                                          |
| -------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `DATA_DIR`           | `./data`                 | 默认 SQLite 和本地媒体路径的基础目录                                          |
| `LOCAL_STORAGE_PATH` | `<DATA_DIR>/media`       | 覆盖本地媒体目录                                                              |
| `LOCAL_PUBLIC_URL`   | 未设置                   | 供 Jant 外部直接提供媒体的公开基地址；留空时，Jant 使用自己的 `/media/*` 路由 |
| `HOST`               | 裸 Node 下是 `127.0.0.1` | `jant start` 的绑定地址                                                       |
| `PORT`               | `3000`                   | `jant start` 的绑定端口                                                       |
| `TRUST_PROXY`        | `false`                  | 是否信任反向代理传来的转发头                                                  |

官方 Docker 镜像默认把 `DATA_DIR` 设为 `/var/lib/jant`，而 Docker Compose 通常会把 `TRUST_PROXY=true`。

### Feed 默认值（可选）

| 变量                        | 默认值     | 说明                                                |
| --------------------------- | ---------- | --------------------------------------------------- |
| `MAIN_RSS_FEED`             | `featured` | 控制 `/feed` 返回 `featured` 还是 `latest`          |
| `RSS_FEEDS_ENABLED`         | `true`     | 是否发布站点、归档和 Collection 的 Atom feeds       |
| `RSS_PUBLISH_DELAY_SECONDS` | `300`      | 帖子及回复发布后，等待多久才进入 Jant 的 Atom feeds |

`featured` 默认开启是有意为之。Jant 假设很多帖子应该留在站点上，但不一定要自动成为默认订阅 feed 的内容。

帖子仍会立即显示在网页上。延迟只影响 Jant 动态生成的 Atom feeds，让作者能在
feed 阅读器抓取前修改或撤回刚发布的内容。它接受 `0–7200` 的整数，也可以在
Config Editor 中实时修改；设为 `0` 可关闭延迟。重置运行时覆盖值后，会重新
使用环境变量。由于 feed 响应还会被缓存，实际延迟可能比配置的最短时间略长。

设置 `RSS_FEEDS_ENABLED=false` 后，所有正式和旧版 feed 地址都会返回 `404`，
页面中的 feed 自动发现、按钮和系统 RSS 导航也会隐藏。Worker 中已经缓存的成功
响应最多还可能保留 60 秒。

### 公开 API 访问（可选）

| 变量                 | 默认值 | 说明                                      |
| -------------------- | ------ | ----------------------------------------- |
| `PUBLIC_API_ENABLED` | `true` | 是否允许无 session 或 token 读取公开 JSON |

关闭后，`/api/public/*` 会对所有调用方返回 `404`；已认证客户端可以改用
`/api/posts`。匿名请求 Collection、导航和搜索 JSON 接口会收到 `401`，浏览器
session 和 Bearer API token 仍可使用这些接口。包括 `/search` 在内的公开 HTML
页面不受影响。

### 分页（可选）

| 变量                | 默认值           | 说明                             |
| ------------------- | ---------------- | -------------------------------- |
| `PAGE_SIZE`         | `50`             | timelines 和 APIs 的默认分页大小 |
| `SEARCH_PAGE_SIZE`  | 继承 `PAGE_SIZE` | 只覆盖搜索页分页                 |
| `ARCHIVE_PAGE_SIZE` | 继承 `PAGE_SIZE` | 只覆盖归档页分页                 |

只有在搜索页或归档页真的需要和全站不同的分页大小时，才去设置 `SEARCH_PAGE_SIZE` 和 `ARCHIVE_PAGE_SIZE`。
三个值都接受 `1–100` 的整数，也可以在 Config Editor 中实时修改；环境变量仍
作为部署时的回退值。

### 存储

存储方式取决于运行时：

| 运行时             | 默认值  | 支持的驱动    |
| ------------------ | ------- | ------------- |
| Cloudflare Workers | `r2`    | `r2`, `s3`    |
| Node 和 Docker     | `local` | `local`, `s3` |

Node 不支持 `r2`，Cloudflare 不支持 `local`。

通过 `STORAGE_DRIVER` 环境变量切换驱动，例如 `STORAGE_DRIVER=s3`。不设置时使用各运行时的默认值。

Node 和 Docker 下 `local` 起步最快，`s3` 更适合长期生产。

#### 本地存储（Node / Docker 下最快起步）

本地存储不需要额外驱动配置。

适合这些场景：

- 想用最简单的方式跑起来
- 本地测试
- 单机的小型安装

默认值：

- `DATA_DIR=./data`
- `LOCAL_STORAGE_PATH=<DATA_DIR>/media`

如果你想把媒体文件放在别处，可以覆盖这个路径：

```env
LOCAL_STORAGE_PATH=/absolute/path/to/jant-media
```

只有在另一个 Web 服务器会直接托管这些文件时，才设置 `LOCAL_PUBLIC_URL`。

#### R2（默认）

Cloudflare Workers 默认使用 R2。

| 变量            | 说明                       |
| --------------- | -------------------------- |
| `R2_PUBLIC_URL` | 直接提供媒体文件的公开 URL |

R2 本身通过 `wrangler.toml` 中的 `[[r2_buckets]]` 绑定来配置。

强烈建议设置 `R2_PUBLIC_URL`。不设置也能工作，但 Jant 就必须通过 Worker 代理每一次媒体请求。

```toml
[vars]
R2_PUBLIC_URL = "https://media.yourdomain.com"
```

#### S3 兼容存储

适合这些场景：

- Node 或 Docker 下想要更稳的长期存储方案
- Cloudflare 和 Node 之间共用同一套存储后端
- 偏好 S3、Backblaze B2、MinIO、DigitalOcean Spaces 或其他兼容服务
- 需要通过预签名 URL 做浏览器直传

| 变量                   | 说明                       |
| ---------------------- | -------------------------- |
| `STORAGE_DRIVER`       | 设为 `s3`                  |
| `S3_ENDPOINT`          | S3 API endpoint            |
| `S3_BUCKET`            | Bucket 名称                |
| `S3_REGION`            | Bucket 区域，默认是 `auto` |
| `S3_PUBLIC_URL`        | 上传文件对外提供的公开 URL |
| `S3_ACCESS_KEY_ID`     | 访问密钥，必须保密         |
| `S3_SECRET_ACCESS_KEY` | Secret key，必须保密       |

示例：

```toml
[vars]
STORAGE_DRIVER = "s3"
S3_ENDPOINT = "https://s3.us-east-1.amazonaws.com"
S3_BUCKET = "my-bucket"
S3_REGION = "us-east-1"
S3_PUBLIC_URL = "https://cdn.example.com"
```

这些凭证应该放进 secrets 存储，不要提交进版本库。

### 浏览器直传的 CORS

如果你使用 `STORAGE_DRIVER=s3`，bucket 必须为实际上传来源的站点 origin 开启 CORS。

推荐的 CORS 策略：

```json
[
  {
    "AllowedOrigins": ["https://your-site.example"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": [
      "Content-Type",
      "Content-Disposition",
      "Cache-Control",
      "x-amz-checksum-sha256"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

如果你会从多个 origin 上传，就把每个 origin 都显式列出来。

### 图片变换（可选）

| 变量                  | 说明                   |
| --------------------- | ---------------------- |
| `IMAGE_TRANSFORM_URL` | 图片变换服务的基础 URL |

如果你使用 Cloudflare 图片变换，请把它指向真正提供图片的域名，并在后面加上 `/cdn-cgi/image`。

示例：

```toml
[vars]
R2_PUBLIC_URL = "https://media.yourdomain.com"
IMAGE_TRANSFORM_URL = "https://media.yourdomain.com/cdn-cgi/image"
```

或者，当图片仍然通过站点域名代理时：

```toml
[vars]
IMAGE_TRANSFORM_URL = "https://yourdomain.com/cdn-cgi/image"
```

### 静态资源 CDN（可选）

| 变量             | 说明                                              |
| ---------------- | ------------------------------------------------- |
| `ASSET_BASE_URL` | 构建产物 JS/CSS 的对外基础 URL（例如独立 CDN 域） |

默认情况下，Jant 把打包后的资源放在站点同源的 `/_assets/` 下。只有当你想把这些资源部署到独立域名时，才需要设置 `ASSET_BASE_URL`。

```toml
[vars]
ASSET_BASE_URL = "https://cdn.yourdomain.com"
```

**该 CDN 必须允许跨域。** Jant 的客户端代码以 ES module 形式加载（`<script type="module">`），浏览器对跨源 module 脚本会强制执行 CORS——虽然它们看起来和普通 JS 没区别。如果 CDN 不返回 `Access-Control-Allow-Origin`，浏览器会丢弃响应，站点直接加载失败。

资源服务器有两种配置方式，根据你的部署情况二选一：

**方案 A：允许任意来源（最简单）**

```
Access-Control-Allow-Origin: *
```

打包产物都是内容哈希文件、可公开缓存，因此用 `*` 是安全的。CDN 可以为所有访问者复用同一个缓存响应。

**方案 B：限定为你的站点域名**

```
Access-Control-Allow-Origin: https://yourdomain.com
Vary: Origin
```

适合同一个 CDN 给多个站点服务、希望按站点隔离的场景。`Vary: Origin` 必须加上，否则 CDN 可能把上一次的 `Allow-Origin` 头返回给另一个来源的请求。如果你的 CDN 不支持按 `Origin` 分缓存键，请使用方案 A。

如果是同源部署（未设置 `ASSET_BASE_URL`），则不涉及任何 CORS 配置。

#### Cloudflare R2 / S3（JSON 格式的 CORS 规则）

如果 CDN 是直接对外暴露的存储桶（R2 公开桶，或 S3 + CloudFront），把桶的 CORS 规则设置为：

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

或限定到你的站点域名：

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

- R2：控制台 → 对应桶 → Settings → CORS policy → 粘贴 JSON
- S3：AWS 控制台 → 桶 → Permissions → Cross-origin resource sharing (CORS)，或用 `aws s3api put-bucket-cors`

#### Caddy / nginx（反向代理的 CDN）

```caddy
# Caddy
header /_assets/* Access-Control-Allow-Origin "*"
```

```nginx
# nginx
location /_assets/ {
    add_header Access-Control-Allow-Origin "*" always;
}
```

### Slug（可选）

| 变量             | 默认值 | 说明                                       |
| ---------------- | ------ | ------------------------------------------ |
| `SLUG_ID_LENGTH` | `5`    | 对无标题帖子自动生成随机 slug 时使用的长度 |

### 上传大小限制（可选）

| 变量                      | 默认值 | 说明                       |
| ------------------------- | ------ | -------------------------- |
| `UPLOAD_MAX_FILE_SIZE_MB` | `1024` | 非图片上传的最大大小（MB） |

图片本身还有更严格的专用限制。这个设置主要影响视频、音频和 PDF 上传。

### 内容摘要和 RSS 限制（可选）

| 变量                     | 默认值 | 说明                         |
| ------------------------ | ------ | ---------------------------- |
| `SUMMARY_MAX_PARAGRAPHS` | `5`    | 自动生成摘要时的最大段落数   |
| `SUMMARY_MAX_CHARS`      | `500`  | 自动生成摘要时的最大字符数   |
| `RSS_FEED_LIMIT`         | `50`   | RSS feeds 中包含的最大帖子数 |

这些值也可以在 Config Editor 中实时修改。段落数范围为 `1–50`，摘要字符数范围
为 `1–1500`，RSS 条目数范围为 `1–200`。重置运行时覆盖值后，会重新使用环境
变量。

## Settings 页面设置

这些设置可以在初始化完成后，通过 Jant 的 Settings 页面修改。所有设置都可以通过同名环境变量预置初始值——Settings 里改过的值优先级高于环境变量。

| 设置                         | 用途                                      |
| ---------------------------- | ----------------------------------------- |
| `SITE_NAME`                  | 站点显示名称                              |
| `SITE_DESCRIPTION`           | Meta description 和 feed description      |
| `SITE_LANGUAGE`              | 主要语言代码                              |
| `DASHBOARD_LANGUAGE`         | 私有管理界面语言                          |
| `CJK_SERIF_FONT`             | CJK 衬线字体回退                          |
| `TIME_ZONE`                  | 显示时区，例如 `UTC` 或 `Asia/Shanghai`   |
| `MAIN_RSS_FEED`              | 决定 `/feed` 返回什么                     |
| `PAGE_SIZE`                  | 默认每页条目数（`1–100`）                 |
| `SEARCH_PAGE_SIZE`           | 每页搜索结果数（`1–100`）                 |
| `ARCHIVE_PAGE_SIZE`          | 每页归档帖子数（`1–100`）                 |
| `SUMMARY_MAX_PARAGRAPHS`     | 摘要段落数上限（`1–50`）                  |
| `SUMMARY_MAX_CHARS`          | 摘要字符数上限（`1–1500`）                |
| `RSS_FEED_LIMIT`             | 每个 RSS feed 的帖子数（`1–200`）         |
| `RSS_PUBLISH_DELAY_SECONDS`  | Feed 发布延迟秒数（`0–7200`）             |
| `SITE_FOOTER`                | 自定义页脚文本                            |
| `SHOW_JANT_BRANDING_ON_HOME` | 是否在首页显示 Jant 品牌标识              |
| `NOINDEX`                    | 请求搜索引擎不要收录这个站点              |
| `PUBLIC_API_ENABLED`         | 是否允许无 session 或 API token 读取 JSON |
| `RSS_FEEDS_ENABLED`          | 是否发布 Atom feeds 和内置 feed 入口      |

多语言站点还有两项设置：`ADDITIONAL_LANGUAGES` 和 `MULTILINGUAL_ENABLED`。它们由语言页写入，不建议手工设置——它们的值必须和帖子上标记的语言保持一致，见[多语言内容](multilingual.md)。

颜色主题、字型主题、自定义 CSS、头像以及其他外观细节，也都在 Settings 里管理。

### Config Editor

打开 **Settings → Advanced → Config Editor**，或访问 `/settings/config`，
即可在一个页面里搜索可以在运行时安全修改的设置。boolean、text、number 和
enum 这类简单值可以直接编辑。内容语言和时区会复用 General 设置中的受限
选项来源，因此不会保存无效的自由输入。Boolean 和 enum 更改会立即保存；
text 和 number 更改会在按 Enter 或离开字段时保存，按 Escape 则恢复最近一次
保存的值。使用 **Reset to default** 会删除数据库覆盖值，恢复环境变量或内置
默认值。在桌面设备上，重置操作会在悬停或聚焦该行时出现；在触屏设备上则
始终可见。

`SITE_NAME`、`SITE_DESCRIPTION` 和 `SITE_FOOTER` 这类站点标识或多行内容会
链接到 General 设置中的权威控件。Config Editor 只显示安全的当前值或配置
状态，避免重复主要表单，也不会把长文本或 Markdown 挤进单行输入框。

需要预览、上传、代码编辑器或多字段流程的设置同样搜得到，但入口会带着当前值
跳到对应的专用 Settings 页面，而不是在 Config Editor 里复制一套简化界面。Theme、Font Theme、Theme Mode 和页眉头像显示这类安全标量也可以在
Config Editor 中重置；文件和自定义代码仍由原设置页的专门清理流程管理。
GitHub Sync 和 Telegram 只显示安全的连接状态并跳转到对应集成页面；仓库
令牌、Bot 令牌、Webhook secret 和临时同步状态仍保持隐藏。

Config Editor 使用显式允许清单。部署基础设施、凭据、集成令牌、生成的资源
元数据和临时内部状态不会出现在这里。跳转行只会暴露安全状态或显示值，不会
显示自定义代码或存储键。

## 保留路径

这些顶层路径是保留的，不能作为 post 或自定义页面的 slug：

```text
featured, latest, collections, signin, signout, setup, settings, dash,
api, feed, search, archive, media, pages, reset, compose, preview, new, static, assets,
_assets, healthz, readyz
```

## 配置文件

### wrangler.toml

把 Cloudflare 的非敏感配置写进 `wrangler.toml`：

```toml
name = "my-jant-site"
main = "index.js"

[vars]
SITE_ORIGIN = "https://myblog.com"
# SITE_PATH_PREFIX = "/blog"
# R2_PUBLIC_URL = "https://media.myblog.com"
# IMAGE_TRANSFORM_URL = "https://media.myblog.com/cdn-cgi/image"

[[d1_databases]]
binding = "DB"
database_name = "my-jant-site-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

[[r2_buckets]]
binding = "R2"
bucket_name = "my-jant-site-media"
```

### .env（Node 和 Docker）

Node 和 Docker 下，把这些值放进 `.env`，或者交给你的进程管理器注入：

```env
AUTH_SECRET=your-32-plus-character-secret
SITE_ORIGIN=https://your-jant.example
DATABASE_URL=file:./data/jant.sqlite
# SITE_PATH_PREFIX=/blog
# TRUST_PROXY=true
```

有用的模板：

- 仓库根目录下的 Docker / Node 示例：[`.env.example`](https://github.com/jant-me/jant/blob/main/.env.example)
- package 内部的 Node 示例：[`packages/core/.env.node.example`](https://github.com/jant-me/jant/blob/main/packages/core/.env.node.example)

### .dev.vars（本地开发）

本地 Cloudflare secrets 放进 `.dev.vars`：

```env
AUTH_SECRET=your-32-plus-character-secret
DEV_API_TOKEN=local-debug-token
DEMO_EMAIL=debug@jant.test
DEMO_PASSWORD=jant-dev-debug-login
DEMO_MODE=false
```

`DEV_API_TOKEN`、`DEMO_EMAIL` 和 `DEMO_PASSWORD` 都是本地调试辅助项，不属于正常生产环境配置。

### Demo Mode

只有在公开共享的 demo 环境里，才把 `DEMO_MODE=true` 打开。

效果：

- 强制开启 `noindex`
- 禁用删除账号、修改密码以及一些账号管理操作
- 仅仅设置 `DEMO_EMAIL` 或 `DEMO_PASSWORD` 并不会自动开启 demo mode

### 生产环境 Secrets

Cloudflare 生产环境可以通过 Wrangler 或 Dashboard 设置 secrets：

```bash
openssl rand -base64 32
npx wrangler secret put AUTH_SECRET
```

## 接下来

- [写作与内容组织](writing-and-organizing.md) —— 开始用 Jant
- [主题定制](theming.md) —— 调整外观
- [备份与恢复](backups.md) —— 准备好长期运行
