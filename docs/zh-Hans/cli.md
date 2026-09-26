# 命令行

`jant` 命令随 `@jant/core` 一起安装。在 Jant 项目目录里用 `npx jant <命令>` 运行；Docker 镜像里 `jant` 已在 PATH 上。`jant --help` 列出所有命令，`jant <命令> --help` 列出一个命令的选项。

本页的命令和选项只在大版本里变动。`jant` 还能运行几个构建和运维用的命令，`--help` 不列出它们；这些属于内部命令，任何版本都可能改变。

## 命令怎么连到站点

命令有两种工作方式。

**直接读写数据库。** `migrate`、`reset-password`、`db export` 和 `site snapshot` 系列命令直接读写数据库，按下面的选项决定用哪个数据库：

| 选项           | 用途                                                   |
| -------------- | ------------------------------------------------------ |
| `--local`      | 本地 D1，也就是 `npm run dev` 用的数据库               |
| `--remote`     | `wrangler.toml` 里的 D1 数据库                         |
| `--node`       | Node 运行时的数据库，来自 `DATABASE_URL` 或 `DATA_DIR` |
| `--config`     | Wrangler 配置文件（默认 `wrangler.toml`）              |
| `--env`        | Wrangler 环境名                                        |
| `--database`   | D1 绑定名（默认 `DB`）                                 |
| `--persist-to` | 本地 D1 状态目录                                       |

不传运行时选项时，设置了 `DATABASE_URL` 或 `DATA_DIR` 就用 Node 运行时，否则用本地 D1。项目目录下的 `.env.node` 会先被读取。

一个数据库里有多个站点时（托管环境），需要指明站点：`--site` 接站点 key 或 ID，`--host` 接域名（子路径下的站点再加 `--path-prefix`），`--url` 接站点 URL。

**通过 HTTP。** `site export`、`site import` 和维护命令调用站点的 API，能在任何可以访问该站点的机器上运行，用 `--url` 指定站点。`site export` 和 `site import` 需要 API token：在 **Settings → API Tokens** 生成，写进 `JANT_API_TOKEN` 或用 `--token` 传入。维护命令需要服务器的 `INTERNAL_ADMIN_TOKEN`，写进这个变量或用 `--token` 传入；不传 `--url` 时，从环境变量或 `wrangler.toml` 读取 `SITE_ORIGIN` 和 `SITE_PATH_PREFIX`。

## 初始化与运行

### `jant setup`

不开浏览器创建管理员账号和站点，效果和 `/setup` 的两屏相同。密码从标准输入读取。已完成初始化的站点不会被改动，所以每次启动都运行也没问题。仅限 Node 运行时的单站点模式。

```bash
printf '%s' "$OWNER_PASSWORD" | npx jant setup --email owner@example.com --password-stdin
```

| 选项               | 用途                                            |
| ------------------ | ----------------------------------------------- |
| `--email`          | 管理员的登录邮箱（必填）                        |
| `--password-stdin` | 从标准输入读取管理员密码（必填）                |
| `--site-name`      | 站点名称                                        |
| `--language`       | 站点的发布语言，BCP 47 标签（默认 `en`）        |
| `--time-zone`      | 站点的 IANA 时区（默认 `UTC`）                  |
| `--site-id`        | 用这个 ID 创建站点，不随机生成                  |
| `--node`           | 即使没有设置 `DATABASE_URL`，也使用 Node 运行时 |

### `jant start`

启动 Node.js 服务器。没有选项，所有配置来自环境变量，见 [配置](configuration.md)。

### `jant migrate`

执行数据库迁移和数据回填。`jant deploy` 和 Docker Compose 会自动运行它。

| 选项                                                                               | 用途                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------- |
| `--local`、`--remote`、`--node`、`--config`、`--env`、`--database`、`--persist-to` | 用哪个数据库，见[上文](#命令怎么连到站点) |

### `jant deploy`

先执行远端迁移，再用正确的静态资源目录部署到 Cloudflare Workers。`--` 之后的参数原样传给 `wrangler deploy`。

| 选项             | 用途                                          |
| ---------------- | --------------------------------------------- |
| `--config`、`-c` | Wrangler 配置文件（默认 `wrangler.toml`）     |
| `--env`、`-e`    | Wrangler 环境名                               |
| `--output`、`-o` | 子路径站点的发布目录（默认 `dist/public`）    |
| `--path-prefix`  | 用这个子路径，不读配置里的 `SITE_PATH_PREFIX` |
| `--database`     | 迁移用的 D1 绑定名（默认 `DB`）               |
| `--skip-migrate` | 部署时不执行迁移                              |

### `jant reset-password`

输出一个 15 分钟内有效的密码重置 token。

| 选项                                                                               | 用途                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------- |
| `--local`、`--remote`、`--node`、`--config`、`--env`、`--database`、`--persist-to` | 用哪个数据库，见[上文](#命令怎么连到站点) |
| `--site`、`--host`、`--path-prefix`、`--url`                                       | 数据库里有多个站点时，指明站点            |

## 迁移与备份内容

各命令的适用场景见 [导出与导入](export-and-import.md)。

### `jant site export`

把站点导出为 Hugo 站点，写成 ZIP 或目录。

```bash
npx jant site export --url https://your-site.example --output ./jant-site-export.zip
```

| 选项              | 用途                                                     |
| ----------------- | -------------------------------------------------------- |
| `--url`           | 站点 URL（必填）                                         |
| `--output`、`-o`  | `.zip` 路径，或一个空目录（默认 `jant-site-export.zip`） |
| `--pull-media`    | 把导出引用的媒体下载到 `static/media/`（默认开启）       |
| `--no-pull-media` | 保留媒体的原始 URL                                       |
| `--token`         | API token，代替 `JANT_API_TOKEN`                         |

### `jant site import`

把 Hugo 站点导出（目录或 ZIP）导入站点。目标站点必须是空的。

```bash
npx jant site import --url https://your-site.example --path ./jant-site-export.zip --dry-run
```

| 选项                  | 用途                                          |
| --------------------- | --------------------------------------------- |
| `--url`               | 站点 URL（必填）                              |
| `--path`              | 导出目录或 ZIP（默认当前目录）                |
| `--dry-run`           | 只读取和检查导出，不调用站点                  |
| `--skip-remote-media` | 帖子正文里的绝对图片 URL 保持原样，不上传图片 |
| `--token`             | API token，代替 `JANT_API_TOKEN`              |

### `jant site pull-media`

下载一份已有导出引用的媒体，并把导出改成使用本地副本。

| 选项       | 用途                                                 |
| ---------- | ---------------------------------------------------- |
| `--path`   | 导出的 ZIP 或目录（默认 `jant-site-export.zip`）     |
| `--output` | `--path` 是 ZIP 时，结果写到哪里（默认覆盖输入文件） |

### `jant site snapshot export`

导出快照：数据库内容连同 ID 和存储 key，以及它们指向的文件。快照用来恢复站点，不用来在不同部署之间迁移内容。

| 选项                                                                               | 用途                                                             |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `--output`、`-o`                                                                   | 目录或 `.zip` 路径（默认 `jant-site-snapshot`）                  |
| `--force`                                                                          | 覆盖已存在的输出路径                                             |
| `--skip-objects`                                                                   | 不带文件，用于已经有相同存储 key 的目标                          |
| `--bucket`、`--bucket-binding`                                                     | 从哪个 R2 bucket 读文件，按名称或 Wrangler 绑定（默认绑定 `R2`） |
| `--local`、`--remote`、`--node`、`--config`、`--env`、`--database`、`--persist-to` | 用哪个数据库，见[上文](#命令怎么连到站点)                        |
| `--site`、`--host`、`--path-prefix`、`--url`                                       | 数据库里有多个站点时，指明站点                                   |

### `jant site snapshot import`

把快照恢复到站点，替换站点的帖子、合集、导航、媒体和自定义 URL。账号和 API token 保留。

```bash
npx jant site snapshot import --path ./jant-site-snapshot.zip --replace
```

| 选项                                                                               | 用途                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `--path`                                                                           | 快照目录或 ZIP（默认当前目录）                                  |
| `--replace`                                                                        | 替换站点内容（必填）                                            |
| `--remap-site`                                                                     | 把快照的站点 ID 和存储 key 改写为目标站点的                     |
| `--allow-missing-objects`                                                          | 数据库引用的文件在快照里缺失时，仍然导入                        |
| `--bucket`、`--bucket-binding`                                                     | 文件写入哪个 R2 bucket，按名称或 Wrangler 绑定（默认绑定 `R2`） |
| `--local`、`--remote`、`--node`、`--config`、`--env`、`--database`、`--persist-to` | 用哪个数据库，见[上文](#命令怎么连到站点)                       |
| `--site`、`--host`、`--path-prefix`、`--url`                                       | 数据库里有多个站点时，指明站点                                  |

### `jant db export`

把整个数据库写成一个 SQL 文件。

| 选项                                                                               | 用途                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------- |
| `--output`、`-o`                                                                   | SQL 文件（默认 `jant-export.sql`）        |
| `--local`、`--remote`、`--node`、`--config`、`--env`、`--database`、`--persist-to` | 用哪个数据库，见[上文](#命令怎么连到站点) |

## 维护

这些命令用 `INTERNAL_ADMIN_TOKEN` 调用站点，分批执行，重复运行不会出错。

### `jant search reindex`

从存储的帖子正文重建搜索索引。

| 选项                | 用途                                        |
| ------------------- | ------------------------------------------- |
| `--url`             | 站点 URL                                    |
| `--limit`           | 每批的帖子数（默认 50，最多 500）           |
| `--once`            | 只执行一批                                  |
| `--token`           | 内部管理 token，代替 `INTERNAL_ADMIN_TOKEN` |
| `--config`、`--env` | 从哪份 Wrangler 配置读取 `SITE_ORIGIN`      |

### `jant posts rebuild-html`

按当前的 HTML 格式重建每篇帖子存储的 HTML。不重建时页面也能正确显示旧帖子；重建省掉每次读取时的重新渲染。

| 选项                | 用途                                        |
| ------------------- | ------------------------------------------- |
| `--url`             | 站点 URL                                    |
| `--site`            | 站点 ID，用于托管多个站点的服务器           |
| `--limit`           | 每批的帖子数（默认 50，最多 100）           |
| `--dry-run`         | 只报告会改动什么，不写入                    |
| `--once`            | 只执行一批                                  |
| `--token`           | 内部管理 token，代替 `INTERNAL_ADMIN_TOKEN` |
| `--config`、`--env` | 从哪份 Wrangler 配置读取 `SITE_ORIGIN`      |

### `jant uploads cleanup`

清理已过期的上传会话，并彻底删除已过 [回收期](backups.md#已删除媒体的回收期) 的已删除媒体。

| 选项                | 用途                                        |
| ------------------- | ------------------------------------------- |
| `--url`             | 站点 URL                                    |
| `--limit`           | 每批的会话数（默认 20，最多 500）           |
| `--token`           | 内部管理 token，代替 `INTERNAL_ADMIN_TOKEN` |
| `--config`、`--env` | 从哪份 Wrangler 配置读取 `SITE_ORIGIN`      |

### `jant telegram register-webhooks`

为 `TELEGRAM_BOT_TOKENS` 里的每个机器人注册 webhook。什么时候需要运行，见 [Telegram 机器人](configuration.md#telegram-机器人可选)。

| 选项    | 用途                                                                     |
| ------- | ------------------------------------------------------------------------ |
| `--url` | 站点的公开 URL（默认取环境变量里的 `SITE_ORIGIN` 和 `SITE_PATH_PREFIX`） |
