# 导出与导入

## 选择合适的工具

| 需求                                         | 使用                                             |
| -------------------------------------------- | ------------------------------------------------ |
| 把其他平台的旧博客迁进 Jant                  | 交给 AI 助手（见下文）                           |
| 在 Jant 站点之间迁移内容，或留一份可移植归档 | `site export` 与 `site import`                   |
| 按原样恢复站点，内部 ID 与存储 key 不变      | `site snapshot export` 与 `site snapshot import` |
| 把数据库导出为 SQL                           | `db export`                                      |

`site export` 和 `site snapshot` 的输出完全不同：

| 维度                      | `site export`                                   | `site snapshot`                      |
| ------------------------- | ----------------------------------------------- | ------------------------------------ |
| 输出格式                  | Hugo 站点目录（Markdown + front matter + 媒体） | SQL dump + 对象存储 dump（二进制包） |
| 能否直接阅读              | 能，用任意编辑器改 Markdown                     | 不能，只有 Jant 能解析               |
| 能否用 Hugo 直接构建      | 能                                              | 不能                                 |
| 内部 ID（post id、media） | 丢弃，导入时重新分配                            | 原样保留                             |
| 草稿与私密帖子            | 包含，front matter 标 `draft: true`             | 包含                                 |
| users / sessions / tokens | 不包含                                          | 不包含                               |
| 媒体存储 key              | 重新生成                                        | 原样保留                             |

换域名、换托管、自己用 Hugo 构建、长期存档，用 `site export`。恢复同一个站点、克隆到 staging、在结构相同的部署之间迁移，用 `site snapshot`。

这些都是一次性命令。定期备份见 [备份与恢复](backups.md)。[GitHub 同步](github-sync.md) 会按 `site export` 的格式持续更新一个仓库。

## 从别的博客或 CMS 迁移过来

其他平台没有现成的导入器，WordPress、Tumblr、Ghost 等平台的导出格式各不相同。迁移交给 AI 助手来做。

创建 Jant 站点后，把下面这句话发给 Claude Code、Codex 这类能运行命令的 AI 助手，`example.com` 换成你的站点地址：

```text
读取 https://example.com/skill.md，帮我把旧博客迁移到这里。
```

`/skill.md` 是写给 AI 助手的站点操作指南。它告诉 AI 助手怎么完成迁移：问清旧博客在哪，帮你导出，第一次写入前再要 [API token](automation-and-api.md)。

## 站点导出（`site export`）

`site export` 把站点导出为 Hugo 站点，格式可以是 ZIP 或目录。它和 `site import`、`site pull-media` 一样走站点的 HTTP API，能在任何可以访问该站点的机器上运行，不需要站点的 `wrangler.toml` 或 `DATABASE_URL`。在安装了 `@jant/core` 的 Jant 项目目录里运行（用 `create-jant` 创建的站点就是项目根目录），并提供 API token：在 **Settings → API Tokens** 生成，写进 `JANT_API_TOKEN` 或用 `--token` 传入。

```bash
JANT_API_TOKEN=jnt_your_token npx jant site export --url https://your-site.example --output ./jant-site-export.zip
```

`--output` 的路径不以 `.zip` 结尾时，导出到这个目录，目录必须为空。要查看导出结果，导出到目录再运行 Hugo：

```bash
npx jant site export --url https://your-site.example --output ./jant-site
cd ./jant-site && hugo serve
```

### 包含与不包含

包含：

- 所有帖子，含 Thread 的回复。草稿和私密帖子也在其中，front matter 标 `draft: true`，Hugo 只在 `hugo --buildDrafts` 时构建它们。
- 帖子和头像用到的媒体，下载到 `static/media/`，归档不依赖原站。`--no-pull-media` 跳过下载。
- 合集、合集目录（顺序、分隔线、自定义链接及其说明）和导航（位置、标签、每一项指向的合集、智能合集或页面），写在 `data/jant.toml`。
- 智能合集，条件和排序写在各自的 `content/{slug}/_index.md`。主题用这些条件筛选导出的帖子，页面列出的内容和 Jant 上一致，仓库里加了帖子也会跟着更新。
- 在 **Settings → Custom URLs** 里设置的重定向，写在 `data/jant.toml` 和 `static/_redirects`。
- 每篇帖子的 `featured_at`、`pinned_at`，以及写在 root bundle 上的 Thread 合集归属，写在 front matter。
- 当前 slug，以及旧 slug 和别名，写在 root 帖子的 `aliases:` 里。自定义的 `alias.html` 模板让旧链接继续可用。
- 显示设置：`SITE_NAME`、`SITE_DESCRIPTION`、`SITE_LANGUAGE`、主题、字型、自定义 CSS、favicon 等，写在 `data/jant.toml` 和 `hugo.toml`。

不包含：

- users、sessions、accounts、verifications 和 API tokens。账户数据不能跨站点迁移。
- 运行时配置：`wrangler.toml`、环境变量、绑定。

### 导出结构

导出是一个标准 Hugo 站点。模板和静态资源打包成 `themes/jant/` 主题，`hugo.toml` 里设置了 `theme = "jant"`：

```
hugo.toml
wrangler.jsonc            Cloudflare Workers 部署配置
content/                  posts、collections、sections
  {slug}/
    _index.md             thread root（branch bundle）
    {reply-slug}/
      index.md            reply（leaf bundle，build.render = "never"）
data/
  jant.toml               导航项、品牌、显示偏好、collections directory
themes/jant/              打包后的 Jant 主题（layouts + static）
README.md
.gitignore
layouts/                  用户自定义覆盖（可选）
static/                   用户自有静态文件 + 下载的媒体
```

### 部署到 Cloudflare Workers

`wrangler.jsonc` 指定 Worker 名称，用 `hugo --gc --minify` 构建，再上传 `public/`，所以部署就是 `npx wrangler deploy` 这一条命令。Hugo 站点没有 `package.json`，Cloudflare 连接仓库时给出的构建命令是空的，保持为空；两边都填，Hugo 会跑两遍。`HUGO_VERSION` 不用设，主题用 Cloudflare 构建镜像自带的 Hugo 就能构建。

`name` 必须和 Cloudflare 控制台里的 Worker 名称一致。不一致时 Workers Builds 会构建失败，手动部署则会部署到另一个 Worker。Cloudflare 用仓库名给从仓库导入的 Worker 命名，所以 [GitHub 同步](github-sync.md) 推送的仓库用仓库名（`My_Blog` 得到 `my-blog`）。下载的导出没有仓库，用 GitHub 同步为这个站点建仓库时建议的名字（`www.example.com` 得到 `example-jant-sync`）。Worker 叫别的名字时，把 `name` 改成一致。Cloudflare 把这个 Worker 的构建 token 命名为 `<worker 名> build token`，可以从这里看到名称。

`wrangler.jsonc` 只写入一次。之后 GitHub 同步推送不会覆盖它，改过的名字会保留。

### URL 结构

| URL                         | 渲染内容                                     |
| --------------------------- | -------------------------------------------- |
| `/`                         | 首页：先列置顶帖子，然后是非置顶帖子的第一页 |
| `/page/N/`                  | 非置顶帖子的分页（N ≥ 2）                    |
| `/archive/`                 | 归档：所有已发布帖子，按时间倒序             |
| `/archive/page/N/`          | 归档分页（N ≥ 2）                            |
| `/featured/`                | Featured：标为 Featured 的帖子，按时间倒序   |
| `/{slug}/`                  | 单个 Thread（root 帖子和内联回复）           |
| `/{reply-slug}/`            | 别名，重定向到 `/{root-slug}/#{reply-slug}`  |
| `/{collection-slug}/`       | 一个合集里的完整 Thread                      |
| `/{smart-collection-slug}/` | 一个智能合集：符合条件的完整 Thread          |
| `/collections/`             | 合集目录                                     |

每页条数跟随 Jant 的 **Settings → Posts per page**。

开启 **Settings → Feeds** 时，导出还会生成 Atom feed：

| URL                                  | 内容         |
| ------------------------------------ | ------------ |
| `/index.xml`                         | 首页时间线   |
| `/featured/index.xml`                | Featured     |
| `/archive/index.xml`                 | 全部归档     |
| `/{collection-slug}/index.xml`       | 单个合集     |
| `/{smart-collection-slug}/index.xml` | 单个智能合集 |

### Feed 地址会变

Jant 的 feed 地址是 `/feed`、`/latest/feed`、`/featured/feed`、`/archive/feed`，以及每个合集和智能合集的 `/{slug}/feed`。Hugo 把同样的 feed 写成各 section 里的 `index.xml`，所以订阅者用的地址在导出站上都不存在。

导出会写一份 `static/_redirects`，把每个旧地址 301 到新地址。Cloudflare Pages 和 Netlify 会直接读取这个文件，迁到这两家不会丢订阅者。其他 host 会忽略它，把域名指过去之前，先把里面的规则改写成该 host 的重定向配置。

让旧帖子链接继续可用的 `aliases:` 页面管不了 feed：它靠 meta refresh 和脚本跳转，feed 阅读器两样都不执行。

feed 条目沿用 Jant 给的 ID，搬站之后，feed 阅读器不会把旧帖子再显示一遍。ID 写在每篇 root 帖子的 `feed_id` 里，是帖子在 Jant 上的地址。导出页面的地址和它不同：末尾多一个斜杠，设过自定义 URL 的帖子还会换成 slug。不要改 `feed_id`，改了 feed 阅读器会把这篇帖子再显示一遍。之后在 Hugo 里写的帖子没有 `feed_id`，用页面地址。

导出站没有 Jant 的 `/subscribe` 页面，导航里的 **Subscribe** 指向主 feed 文件。

### 导出再导入

`site import` 会还原 `site export` 写下的这些状态：

- `featured_at` 和 `pinned_at` 是 ISO 时间戳，重新导入后恢复到帖子被 Featured 或置顶的具体时刻。
- Thread 的合集归属写在 root 的 `collections` 数组里，每条带 `collected_at`、`position` 和该合集内的 `pinned_at`。回复不重复写。旧版导出在每篇帖子上都写了 `collections`，也能导入。
- 用 **Reply quietly** 发布的回复带 `quiet_reply: true`。没有这个字段的旧版导出，导入时读取 root 的 `last_activity_at`，这类回复不会把 Thread 顶上去。
- 每条回复的 `weight` 是它在 Thread 里的位置，导入按这个顺序创建回复。同一秒发布的帖子也保持原来的先后。
- `created` 和 `updated` 记录帖子的写作时间和最后编辑时间，与 `date` 不同时才写。搬站之后，feed 和 sitemap 报的仍是原来的时间。
- 视频和音频保留 `duration_seconds`。
- 智能合集的 `selection` 记录它的条件，合集条件写的是合集的 slug。导入在合集之后重建智能合集。条件里的合集没有一起导入时，这个智能合集会跳过并给出警告：少了这个条件，它会收进原本不属于它的帖子。

本页没有列出的 front matter 字段是 Jant 内部字段，不要手动修改：下次导入会把它们原样写回数据库，覆盖你之后在 Jant 里做的修改。

### 单独拉取媒体

`site pull-media` 对已有的导出（目录或 ZIP）单独执行媒体下载。适用于用 `--no-pull-media` 导出之后、导出后又新增了媒体，或上一次拉取中断的情况。

```bash
# 针对已解压目录
npx jant site pull-media --path ./jant-site

# 针对 ZIP（默认覆盖原文件）
npx jant site pull-media --path ./jant-site-export.zip

# 针对 ZIP 并输出至新文件
npx jant site pull-media --path ./jant-site-export.zip --output ./pulled.zip
```

它扫描所有 Markdown 文件和 `hugo.toml`，把每个远程媒体文件下载到 `static/media/`，并把引用改成本地路径。`static/media/` 里已有的文件直接复用，重复运行不会出问题。下载失败的文件保留原 URL，Hugo 照样能构建。

### 自定义导出

下次导出或 [GitHub 同步](github-sync.md) 推送都会覆盖 `themes/jant/**`，不要直接修改它。同步的仓库每次推送还会重写 `content/**`、`data/jant.toml`、`hugo.toml`、`.gitignore` 和 `README.md`，并删除这些路径下 Jant 不再生成的文件。根目录的 `layouts/`、`static/`、`data/` 下你自己的文件以及其他文件都不会被改动。自定义的方式：

- 改单个模板：把 `themes/jant/layouts/<name>.html` 复制到根目录 `layouts/<name>.html`，改这份副本。Hugo 优先加载根目录的模板。本页列出的 front matter 字段只在大版本里变动；主题的模板和 partial 任何版本都可能改变，升级 Jant 后要对照新主题检查复制出来的模板。
- 额外的静态文件放在根目录 `static/`，同名时优先于 `themes/jant/static/` 里的文件。
- 颜色、字体和布局细节在 Jant 的 **Settings → Custom CSS** 里改，每次导出都会写入 `themes/jant/static/custom.css`。
- 站点级配置在 Jant 的 **Settings** 里改，不要改 `hugo.toml`。

## 站点导入（`site import`）

`site import` 把一份导出（目录或 ZIP）导入 Jant 站点。先加 `--dry-run` 运行一遍：完整校验，不写任何数据。Dry run 不会连接站点，但 URL 仍然必填。

```bash
npx jant site import --url https://your-site.example --path ./jant-site-export.zip --dry-run
```

然后正式导入，需要 `JANT_API_TOKEN` 或 `--token`：

```bash
JANT_API_TOKEN=jnt_your_token npx jant site import --url https://your-site.example --path ./jant-site-export.zip
```

### 冲突与约束

导入逐条写入帖子和合集，不合并、不覆盖、不回滚。

- 目标站点上某个 slug 已被帖子、合集、别名或重定向占用时，导入立即停止。停止前写入的内容会留在站点上，需要手动清理。
- 导出内部有重复 slug（比如手动改过 Markdown 文件）时，同样会停止。
- 目标站点不必是空的，但导出和源站重叠太多，实际上都是导入到一个干净的站点。
- `data/jant.toml` 记录导出的格式 `version`。导出的格式比导入方能读的更新时，导入在写入任何数据之前停止，提示先升级 `@jant/core`。旧格式的导出可以导入。

### 清空目标站点

Jant 目前没有「只删内容、保留账号」的单独操作。导入失败或只导了一部分时，最快的重来方式是 **Settings → Account & Data → Delete Account**，然后重新注册。这个流程会先要求下载一份 `site export` 作为最后的备份，再要求输入确认短语。

托管站点上的 **Delete Account** 同样删除内容和账号，但计费、域名绑定和 jant.me 上的实例本身都会保留，重新注册后可以在同一个实例上重新设置。

### 跳过正文中的远程图片

默认情况下，导入会把所有媒体复制到目标站点：front matter `media:` 里声明的文件、正文中 `![](...)` 引用的图片（包括远程 URL）和头像。正文里的 URL 会改成新地址，源站下线后目标站点照常可用。

如果不想把指向第三方 URL 的图片（imgur、Wikipedia 或任何 `https://` 链接）存进自己的存储，比如出于带宽或版权考虑，加 `--skip-remote-media`：

```bash
npx jant site import --url https://your-site.example --path ./jant-site-export.zip --skip-remote-media
```

加上后，相对路径（`/media/...`、`./foo.png`）属于源站自己的文件，仍会上传；绝对 URL（`https://...`、`//cdn...`）原样留在正文里。front matter `media:`、头像和文本附件始终会迁移。

如果源站用自己的存储域名提供媒体，比如 R2 公开域名 `media.yourdomain.com` 或 S3 CDN，这些正文图片也算绝对 URL。只有确定该域名会长期可用时才用这个 flag，例如源站和目标站共用同一个存储桶。否则源站的存储下线后，这些图片就失效了。

## 运行环境

`site snapshot export/import` 和 `db export` 直接读写数据库和媒体存储，必须在站点的部署环境里运行：在项目目录下持有该站点的 `wrangler.toml`，或者使用相同的 `DATABASE_URL`、`LOCAL_STORAGE_PATH`、`S3_*` 等运行时变量。

| 标志       | 目标                  | 所需环境                               |
| ---------- | --------------------- | -------------------------------------- |
| `--remote` | 远端 Cloudflare D1/R2 | `wrangler.toml`，wrangler 已认证       |
| `--local`  | 本地 D1（wrangler）   | `wrangler.toml`                        |
| `--node`   | Node runtime          | `DATABASE_URL` 与对应 storage 配置变量 |

不传标志时，shell 里设置了 `DATABASE_URL` 或 `DATA_DIR` 就用 Node runtime，否则用本地 D1（要求工作目录下有 `wrangler.toml`）。CLI 启动时会输出一行 `[jant] target = ...`，可以据此核对。

`--remote` 通过本地的 `wrangler` CLI 运行，需要先 `wrangler login` 或设置 `CLOUDFLARE_API_TOKEN`。`--config` 指定非默认的 wrangler 配置文件。

CLI 启动时会加载 `<cwd>/.env.node`，shell 里已经 export 的变量优先。`JANT_ENV_FILE` 用来加载另一个文件，一台机器管理多个部署时会用到；设为空值则跳过该文件，自动化任务用这种方式避开本地的 `.env.node`。完整的环境变量列表见 [配置](configuration.md)。

## 站点快照（`site snapshot`）

快照原样保留 Jant 的内部 ID、存储 key 和媒体文件，用来恢复站点，不用来迁移内容。它直接读写数据库（见 [运行环境](#运行环境)），托管站点用不了。

### 包含与不包含

快照包含：

- 帖子，含草稿和私密帖子，`status` 和 `visibility` 原样保留。
- 合集、合集目录项和导航项。
- 媒体记录和 path registry 记录。
- 这些记录引用的存储对象。归档大小约等于媒体总量；`--skip-objects` 可以不带这些对象。
- 显示设置：站点名、描述、主题、字型、favicon、自定义 CSS、时区等。
- 语言配置：主语言、带前缀的其他语言，以及 [多语言内容](multilingual.md) 是否开启。每篇帖子的语言和译文关联随帖子一起带走。

快照不包含（导出时就排除）：

- users、sessions、accounts、verifications 和 API tokens。
- 运行时配置（`wrangler.toml`、环境变量）。
- 代码注入（**设置 → 代码注入**）。自定义 CSS 会带走，自定义 head 和 body HTML 不会，所以导入归档不能在导入的站点上执行脚本。
- GitHub 同步和 Telegram 绑定，以及它们的 token 和同步状态。它们指向的仓库或聊天不属于目标站点。

快照不带登录凭据，导入的人之后要自己注册账号。

归档由三部分组成：

```
jant-site-snapshot.zip
├── meta.json                  // { format, version, dialect, jant, schema, site }
├── db.sql                     // 完整 SQL，包含 favicon.ico 的 base64
└── objects/<storage-key>/...  // 所有 media 引用的对象
```

### 导出快照

不传标志时，目标按 [运行环境](#运行环境) 自动选择（本地 D1 或 Node）：

```bash
npx jant site snapshot export --output ./jant-site-snapshot.zip
```

Node runtime，适用于 SQLite 或 Postgres 部署：

```bash
DATABASE_URL=postgres://... npx jant site snapshot export --node --output ./jant-site-snapshot.zip
```

远端 Cloudflare D1：

```bash
npx jant site snapshot export --remote --config ./wrangler.toml --output ./jant-site-snapshot.zip
```

### 跳过媒体文件

源站和目标站共用同一个 R2 或 S3 存储桶时（例如把数据库迁到另一个 Worker，媒体已经在目标桶里），`--skip-objects` 不导出 `objects/`，归档只剩 `meta.json` 和 `db.sql`。

```bash
npx jant site snapshot export --output ./jant-site-snapshot.zip --skip-objects
```

目标存储里必须已有 `db.sql` 引用的全部 storage key，否则导入后所有媒体引用都会 404。导入时加 `--allow-missing-objects`（见下文）；不加的话，导入会停在预检阶段并列出缺失的 key。

### 导入快照

快照导入必须加 `--replace`。它会清空目标数据库中快照涵盖的内容表（`post`、`collection`、`nav_item`、`collection_directory_item`、`thread_collection`、`media`、`path_registry`），再写入快照内容。users、sessions 和 tokens 不受影响。不加 `--replace` 时导入直接拒绝运行。

媒体文件会上传到目标站点自己的存储，所以 R2 上导出的快照可以导入到用 S3 或本地磁盘存媒体的站点。导出使用快照格式 v2，导入也接受 v1。`meta.json` 记录写出快照的 Jant 版本（`jant`）和该版本最后一个数据库迁移（`schema`）。快照来自比导入方更新的 Jant 时，导入在写入任何数据之前停止，提示先升级 `@jant/core`。

```bash
npx jant site snapshot import --path ./jant-site-snapshot.zip --replace
```

远端 Cloudflare D1：

```bash
npx jant site snapshot import --remote --config ./wrangler.toml --path ./jant-site-snapshot.zip --replace
```

### 允许缺失对象

写入前，导入会把 `db.sql` 里的每个 `storage_key` 和 `poster_key` 与 `objects/` 中的文件比对，有缺失就停止并列出完整清单。如果目标存储里已经有这些文件（比如把 `--skip-objects` 归档导入到与源站共用 R2 桶的 Worker），用 `--allow-missing-objects` 跳过这项检查：

```bash
npx jant site snapshot import \
  --path ./jant-site-snapshot.zip \
  --replace \
  --allow-missing-objects
```

缺失清单仍会输出到 stderr，可以重定向到文件留作记录。

## 数据库导出（`db export`）

`db export` 把数据库导出为原始 SQL，不含媒体文件。适合查看表内容、和其他备份一起保留一份 SQL dump，或接入自己的工具。它不是完整备份，媒体的处理见 [备份与恢复](backups.md)。Postgres 部署也可以直接用 `pg_dump`，见 [备份与恢复 § Node + Postgres](backups.md#node--postgres)。

不传标志时，目标按 [运行环境](#运行环境) 自动选择：

```bash
npx jant db export --output ./jant-export.sql
```

Node runtime：

```bash
DATABASE_URL=postgres://... npx jant db export --node --output ./jant-export.sql
```

远端 Cloudflare D1：

```bash
npx jant db export --remote --config ./wrangler.toml --output ./jant-remote.sql
```

## 接下来

- [备份与恢复](backups.md)：完整的备份与恢复方案
- [GitHub 同步](github-sync.md)：把内容备份到 GitHub 仓库，并在那里编辑
- [自动化与 API](automation-and-api.md)：把上述操作写成脚本
- [API 参考（英文）](../API.md)
