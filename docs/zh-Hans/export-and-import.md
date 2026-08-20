# 导出与导入

本文涉及的所有命令应在已安装 `@jant/core` 的 Jant 项目目录中运行。通过 `create-jant` 创建的站点，通常即为项目根目录。

## 选择合适的工具

| 需求                       | 使用                                             |
| -------------------------- | ------------------------------------------------ |
| 跨 Jant 站点迁移内容       | `site export` 与 `site import`                   |
| 生成可移植的静态归档       | `site export`                                    |
| 按原样恢复内部 ID 与存储键 | `site snapshot export` 与 `site snapshot import` |
| 导出原始数据库 SQL         | `db export`                                      |
| 从别的博客或 CMS 迁入内容  | 交给 AI 助手（见下文）                           |

`site export` 与 `site snapshot` 的差别不在于「用途」，而在于输出物本身：

| 维度                      | `site export`                                   | `site snapshot`                      |
| ------------------------- | ----------------------------------------------- | ------------------------------------ |
| 输出格式                  | Hugo 站点目录（Markdown + front matter + 媒体） | SQL dump + 对象存储 dump（二进制包） |
| 是否人类可读              | 是，可直接用编辑器改 Markdown                   | 否，需要 Jant 解析                   |
| 能否用 Hugo 直接构建      | 能                                              | 不能                                 |
| 内部 ID（post id、media） | 丢弃，导入时重新分配                            | 原样保留                             |
| 草稿与私密 post           | 包含，front matter 标 `draft: true`             | 包含                                 |
| users / sessions / tokens | 不包含                                          | 不包含                               |
| 媒体存储 key              | 重新生成                                        | 原样保留                             |

一句话决策：换域名、换托管、用 Hugo 自建、长期存档——`site export`。同站恢复、克隆到 staging、在结构相同的部署间迁移——`site snapshot`。

本页只讲一次性命令；要持续备份，看 [备份与恢复](backups.md)；要把导出长期同步到 GitHub 仓库，看 [GitHub 同步](github-sync.md)，它复用同一份 `site export` 格式。

## 从别的博客或 CMS 迁移过来

上面这些工具是在 Jant 站点之间搬内容。从非 Jant 来源迁入——WordPress、Tumblr、Ghost、一份 RSS 导出——没有固定的导入器，因为每个平台的导出格式都不一样。

这种情况把当前站点的 `/skill.md` 地址（例如 `https://example.com/skill.md`）交给 AI 助手即可。这是一份绑定当前站点的 Jant 操作指南，其中包含专门的导入流程，讲清楚了数据模型、来源格式映射、断点续跑和迁移验证。把导出文件和一个 [API token](automation-and-api.md) 给它，让它来跑这次迁移。

## 运行环境

本文档涉及的命令分为两类，所需环境差异显著。运行前需确认所处类别与对应配置。

### HTTP API 类

`site export <url>`、`site import <url>`、`site pull-media`

通过站点公开 URL 调用 HTTP API，**不直接访问数据库或对象存储**，因此可在任意机器上对任意可达的 Jant 站点运行，无须站点的 `wrangler.toml` 或 `DATABASE_URL`。

需要一个 API token：

```bash
export JANT_API_TOKEN=jnt_your_token
```

Token 在站点的 **Settings → API Tokens** 中生成，亦可通过 `--token` 直接传入。

### 直连数据存储类

`site snapshot export/import`、`db export`

直接读写 Jant 的数据库与媒体存储，因此必须在站点对应的部署环境中运行（持有该站点的 `wrangler.toml`，或与该站点共享 `DATABASE_URL`、`LOCAL_STORAGE_PATH`、`S3_*` 等运行时变量）。

运行目标按以下规则解析：

| 标志       | 目标                  | 所需环境                               |
| ---------- | --------------------- | -------------------------------------- |
| `--remote` | 远端 Cloudflare D1/R2 | `wrangler.toml`，wrangler 已认证       |
| `--local`  | 本地 D1（wrangler）   | `wrangler.toml`                        |
| `--node`   | Node runtime          | `DATABASE_URL` 与对应 storage 配置变量 |

不传任何标志时按以下顺序自动选择目标：

1. shell 中存在 `DATABASE_URL` 或 `DATA_DIR` → Node runtime；
2. 否则 → 本地 D1（要求工作目录下有 `wrangler.toml`）。

CLI 启动时会输出一行 `[jant] target = ...`，用于核对实际选中的目标。

`--remote` 经由本地 `wrangler` CLI 调用，需先 `wrangler login` 或设置 `CLOUDFLARE_API_TOKEN`；`--config` 用于指定非默认的 wrangler 配置文件路径。

CLI 启动时会自动加载 `<cwd>/.env.node`，但已通过 `export` 设置的 shell 变量优先级更高、不会被覆盖。把这些变量写进 `.env.node` 即可，不需要每次手动 `source`。

完整的环境变量列表见 [配置](configuration.md)。

## 站点导出（`site export`）

`site export` 生成兼容 Hugo 的站点导出，输出格式为 ZIP 归档或目录。典型用途包括跨 Jant 站点迁移内容、在本地用 Hugo 构建预览、长期保留可移植的内容归档。

导出默认会把引用的媒体文件下载至 `static/media/`，使归档自包含。如果导出由 Jant 生成，`data/jant.toml` 会同时保留 round-trip 导入所需的元数据，包括头部导航与 collections directory 结构（顺序、divider、自定义链接）。

### 包含与不包含

包含：

- **所有 post**（含 Thread 的回复）。草稿与私密 post 也会进入归档，front matter 标 `draft: true`，Hugo 默认不构建它们；需要 `hugo --buildDrafts` 才会渲染。
- post 与头像引用的媒体文件，默认下载到 `static/media/`，可加 `--no-pull-media` 跳过。
- collections、collections directory（顺序、divider、自定义链接）、头部导航——写入 `data/jant.toml`。
- 每个 post 的 `featured_at`、`pinned_at`，以及写在 root bundle 上的 Thread 级 collection 归属，都会进入 front matter 供 round-trip 还原。
- **当前 slug 加历史别名/重定向**：post 改过 slug 时，`path_registry` 里的旧 slug 会作为 `redirect` 行保留下来；导出时和 `alias` 行一并写进 root post 的 `aliases:`，Hugo 通过自定义 `alias.html` 模板让旧链接继续可用。
- 站点显示设置：`SITE_NAME`、`SITE_DESCRIPTION`、`SITE_LANGUAGE`、主题、字型、自定义 CSS、favicon 等，写入 `data/jant.toml` 与 `hugo.toml`。

不包含：

- users、sessions、accounts、verifications、API tokens——账户与认证数据，跨站点不可移植。
- 站点级运行时配置（`wrangler.toml`、环境变量、绑定）。
- **智能合集。** 它的成员是一条查询，而导出出来的 Hugo 站点没有数据库可以跑这条查询。诚实的做法只有两种：不导出，或者把今天命中的结果冻结下来、挂在一个承诺会持续更新的名字底下。导出选前者。帖子本身一篇不少——智能合集只是把帖子聚在一起，并不拥有它们——丢的只是「聚」这件事，在目标站点重建一次即可。

### 导出结构

导出本质是一个标准 Hugo 站点。模板与静态资源被打包为 `themes/jant/` 主题，`hugo.toml` 中设置 `theme = "jant"`：

```
hugo.toml
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

根目录下的 `layouts/` 与 `static/` 由用户自由维护。Hugo 优先加载根目录的 `layouts/<name>.html` 而非 `themes/jant/layouts/<name>.html`，因此可以在不 fork 主题的前提下单独覆盖任意模板。

### URL 方案

| URL                   | 渲染内容                                         |
| --------------------- | ------------------------------------------------ |
| `/`                   | 首页：置顶 post 优先，随后是非置顶 post 的第一页 |
| `/page/N/`            | 非置顶 post 的分页（N ≥ 2）                      |
| `/archive/`           | 归档：所有已发布 post，按时间倒序                |
| `/archive/page/N/`    | 归档分页（N ≥ 2）                                |
| `/featured/`          | 精选：标记为 Featured 的 post，最新优先          |
| `/{slug}/`            | 单条 Thread（root post 与内联回复）              |
| `/{reply-slug}/`      | Alias，重定向至 `/{root-slug}/#{reply-slug}`     |
| `/{collection-slug}/` | 一个 collection 中的完整 Threads                 |
| `/collections/`       | Collections directory                            |

每页条数由 Jant **Settings → Posts per page** 控制。

### Round-trip 保真

`site export` → `site import` 一次往返会完整保留每个 post 的 Featured、置顶状态，以及每个 Thread 的 collection 归属：

- `featured_at` 与 `pinned_at` 在 front matter 里写 ISO 时间戳，而非布尔值；重新导入后会恢复到该 post 当时被 Feature 或置顶的具体时刻。
- Thread root 的 front matter 顶层 `collections` 数组中，每条 entry 携带 `collected_at`、`position` 与 per-collection `pinned_at`；回复 leaf bundle 不再重复 Thread 归属。
- Import 仍兼容旧导出中逐 post 写入的 `collections`：导入前会按 Thread 取并集，重复归属取最新 `collected_at`、最新 `pinned_at` 与最小 `position`。
- Thread root 的 `last_activity_at` 会保留 **Reply quietly** 的效果。导出里没有 per-reply 的 quiet 字段；导入时会用 root 的活动时间判断哪些回复原本不应把 thread bump 到 Latest 顶部。

未在文档中列出的字段属于 Jant 内部使用，不要手动改：再次导入时它们会原样写回数据库，覆盖你后来在 Jant 中的修改。

### 导出站点

需要 `JANT_API_TOKEN` 环境变量（或 `--token`），见 [运行环境 § HTTP API 类](#http-api-类)。

```bash
JANT_API_TOKEN=jnt_your_token npx jant site export https://your-site.example --output ./jant-site-export.zip
```

若需直接查看生成的站点结构，可导出至目录：

```bash
npx jant site export https://your-site.example --directory ./jant-site
cd ./jant-site && hugo serve
```

### 单独拉取媒体

`site export` 默认下载媒体，但拉取步骤也可针对已存在的导出（目录或 ZIP）单独执行。常见场景：先前以 `--no-pull-media` 导出、导出后新增了媒体、或上一次拉取过程中断。

```bash
# 针对已解压目录
npx jant site pull-media --path ./jant-site

# 针对 ZIP（默认覆盖原文件）
npx jant site pull-media --path ./jant-site-export.zip

# 针对 ZIP 并输出至新文件
npx jant site pull-media --path ./jant-site-export.zip --output ./pulled.zip
```

该命令扫描所有 markdown 文件与 `hugo.toml`，把每个远程媒体引用下载至 `static/media/` 并重写为本地路径。操作是幂等的：`static/media/` 中已存在的文件会直接复用，不重复下载。下载失败的引用保留原 URL，不影响 Hugo 构建。

### 自定义导出

`themes/jant/` 是打包后的 Jant 主题。如果该导出与 GitHub 仓库做了双向同步，每次 Jant 推送会按以下规则更新仓库：

- **覆盖并清理**（managed paths）：`themes/jant/**`、`content/**`、`data/jant.toml`、`hugo.toml`、`.gitignore`、`README.md`。这些路径下 Jant 不再生成的文件会被删除，例如已删除的 post 对应目录。
- **保留**（unmanaged paths）：根目录 `layouts/`、`static/`、`data/` 下用户自建的 Hugo data 文件，以及任何不在上面 managed 列表中的文件，都不会被覆盖或删除。

因此自定义主题与新增静态资源应放在 unmanaged 路径里，不要直接编辑 `themes/jant/**`。

支持的自定义方式：

- **覆盖单个模板**：把 `themes/jant/layouts/<name>.html` 复制到根目录 `layouts/<name>.html`，然后编辑根目录副本。Hugo 优先加载根目录模板，不需要 fork 整个主题。
- **新增静态文件**：放在根目录 `static/`，将以对应 URL 提供服务，并优先于 `themes/jant/static/` 下的同名文件。
- **调整颜色、字体或布局细节**：用 Jant 中的 **Settings → Custom CSS**。该值在每次 export 时写入 `themes/jant/static/custom.css`，应通过 Settings 修改，而不是直接编辑仓库。

直接编辑 `themes/jant/**` 不受支持，下次 sync 或 export 会覆盖修改。站点级配置请通过 Jant 的 **Settings** 调整，不要手动编辑 `hugo.toml`。

## 站点导入（`site import`）

`site import` 读取 site export 目录或 ZIP 并将其导入 Jant。典型用途包括 Jant 站点之间的迁移、从可移植导出中恢复内容、以及在写入前预览导入结果。

### 冲突与约束

Import 不做合并、不做覆盖、不做事务回滚——它逐条把入站 post 与 collection 的 slug 与目标站点的 `path_registry` 比对：

- 如果某个 slug 已被现有的 post、collection、alias 或 redirect 占用，命令立即终止；之前已经写入的内容**保留**在目标站点（部分写入状态需要手动清理）。
- 目标站点不必完全为空，但实际上你只会把一份导出导进一个干净站点——和源站重叠的内容几乎一定会撞 slug。
- 同一份导出内部如果存在重复 slug（例如手工编辑了多份 markdown 后再导入），同样会触发冲突并退出。
- `--dry-run` 提前跑完整套校验，不写任何数据。推荐先 dry-run 再执行真正的 import。

### 清空目标站点

迁移时如果遇到字段冲突或一次没导干净，目前没有「只清空内容、保留账号」的轻量入口。最快的做法是去 **Settings → Account & Data → Delete Account** 把账号连同内容一起删掉，再重新注册——这是初次迁移调试常用的快捷方式。流程会先强制下载一份 `site export` 作为最后的备份，再要求输入确认短语。

托管站点上点这个 **Delete Account** 删的也是该站点的内容和账号，不影响计费、域名绑定和你在 jant.me 上的实例本身——重新注册后实例还在，可以直接重新初始化。

### 先执行 Dry Run

Dry-run 不会连接目标站点，但 URL 仍为必填项，以保持参数形态一致：

```bash
npx jant site import https://your-site.example --path ./jant-site-export.zip --dry-run
```

### 导入到站点

与 `site export` 同样需要 `JANT_API_TOKEN`（或 `--token`）：

```bash
JANT_API_TOKEN=jnt_your_token npx jant site import https://your-site.example --path ./jant-site-export.zip
```

### 跳过 body 中的远程图片

默认情况下，import 会把所有媒体重新托管到目标站点：front matter `media:` 中声明的资源、body 中 `![](...)` 引用的图片（包括远程 URL）以及头像，都会被抓取上传，body 中的 URL 也会重写至新地址。这样目标站点完全独立于源站点，源站点后续下线不会影响目标站点的图片可用性。

如果不想把 body 中**指向第三方 URL 的图片**（如 imgur、Wikipedia 等任意 https 链接）镜像到自有存储——出于带宽、版权或必要性的考量——可加 `--skip-remote-media`：

```bash
npx jant site import https://your-site.example --path ./jant-site-export.zip --skip-remote-media
```

启用后：

- **相对路径**（`/media/...`、`./foo.png`）：仍会上传，属于源站点自有文件。
- **绝对 URL**（任意 `https://...`、`//cdn...`）：不抓取、不上传，body 中保留原值。

Front matter `media:` 声明的资源、头像与文本附件不受此 flag 影响，始终会被迁移。

> **注意**：如果源站点把媒体托管在独立存储域名上（如 R2 公开域名 `media.yourdomain.com`、S3 CDN 等），body 中的此类图片也会被识别为绝对 URL。仅在确定该域名长期可用时启用此 flag（例如源站点与目标站点共用同一存储桶），否则源站点 R2 失效后相关图片将全部不可用。

## 站点快照（`site snapshot`）

`site snapshot export` 与 `site snapshot import` 会完整保留 Jant 内部的 ID、存储 key 以及对象文件。当你需要的是可往返恢复的快照而不是内容迁移时，用 snapshot。

### 包含与不包含

Snapshot 包含：

- post（含草稿与私密 post，原样保留 `status` 与 `visibility`）。
- collection、collection directory item、navigation item。
- media 记录、path registry 记录。
- 上述记录引用的存储对象本身（默认全量下载，归档大小约等于媒体总量；可加 `--skip-objects` 跳过）。
- 一组站点显示设置（站点名、描述、语言、主题、字型、favicon、自定义 CSS、时区等）。

Snapshot **不包含**（导出时即被排除，不写入归档）：

- users、sessions、accounts、verifications。
- API tokens。
- 站点运行时配置（`wrangler.toml`、环境变量）。

也就是说：把 snapshot 文件分发给他人不会泄露登录凭据，但目标站点导入后需要自行注册账号。

归档结构由三部分组成：

```
jant-site-snapshot.zip
├── meta.json                  // { format, version, site }
├── db.sql                     // 完整 SQL，包含 favicon.ico 的 base64
└── objects/<storage-key>/...  // 所有 media 引用的对象
```

### 导出 Snapshot

默认目标（按 [运行环境](#运行环境) 自动推导，本地 D1 或 Node）：

```bash
npx jant site snapshot export --output ./jant-site-snapshot.zip
```

显式 Node runtime（如 SQLite 或 Postgres 部署）：

```bash
DATABASE_URL=postgres://... npx jant site snapshot export --node --output ./jant-site-snapshot.zip
```

远端 Cloudflare D1：

```bash
npx jant site snapshot export --remote --config ./wrangler.toml --output ./jant-site-snapshot.zip
```

### 跳过媒体文件下载

如果源与目标共用同一个 R2 / S3 存储桶（例如只想把数据库状态迁到另一个 Worker，而媒体文件已存在于目标桶中），可用 `--skip-objects` 跳过 `objects/` 目录：

```bash
npx jant site snapshot export --output ./jant-site-snapshot.zip --skip-objects
```

此时归档仅包含 `meta.json` 与 `db.sql`，体积显著缩小。

> **前提**：目标存储中已包含 `db.sql` 引用的全部 storage key（典型场景是源与目标共用同一个 R2 / S3 桶）。否则导入后所有 media 引用都会 404。
>
> 导入时需配合使用 `--allow-missing-objects`（见下文）；不加该标志时 import 会停在预检阶段并列出缺失的 key。

### 导入 Snapshot

Snapshot import 必须显式传 `--replace`。`--replace` 会清空目标库中 snapshot 涵盖的表（post、collection、nav_item、collection_directory_item、thread_collection、media、path_registry），再按 snapshot 内容重新写入。users、sessions、tokens 不在涵盖范围内，保持不变。没有 `--replace` 时 import 直接拒绝运行，避免误覆盖。

当前导出使用 snapshot format v2。Import 仍接受 v1 snapshot：会先在内存中把旧 `post_collection` 行升级成 Thread 级并集，确认可转换后才清空目标内容。

默认目标：

```bash
npx jant site snapshot import --path ./jant-site-snapshot.zip --replace
```

远端 Cloudflare D1：

```bash
npx jant site snapshot import --remote --config ./wrangler.toml --path ./jant-site-snapshot.zip --replace
```

### 允许缺失对象

Import 默认执行一次预检：从 `db.sql` 中提取所有 `storage_key` 与 `poster_key`，与 `objects/` 目录中的文件做比对。任何缺失都会触发中止，并输出缺失 key 的完整列表。

如果已确认目标 storage 中存在这些文件（例如把 `--skip-objects` 归档导入到与源共用 R2 桶的 Worker），可用 `--allow-missing-objects` 跳过该校验：

```bash
npx jant site snapshot import \
  --path ./jant-site-snapshot.zip \
  --replace \
  --allow-missing-objects
```

即使启用该 flag，缺失列表仍会输出至 stderr，可重定向保存以便后续审计。

## 数据库导出（`db export`）

`db export` 把当前数据库导出为原始 SQL，**不包含媒体文件**。它适合用来检查表内容、与其他备份并存留作 SQL dump、或接入自有运维工具链；**不适合作为完整备份**——媒体文件需另行处理，参见 [备份与恢复](backups.md)。Postgres 部署也可以直接用 `pg_dump`，详见 [备份与恢复 § Node + Postgres](backups.md#node--postgres)。

默认目标（按 [运行环境](#运行环境) 自动推导）：

```bash
npx jant db export --output ./jant-export.sql
```

显式 Node runtime：

```bash
DATABASE_URL=postgres://... npx jant db export --node --output ./jant-export.sql
```

远端 Cloudflare D1：

```bash
npx jant db export --remote --config ./wrangler.toml --output ./jant-remote.sql
```

## 接下来

- [备份与恢复](backups.md) —— 完整的备份与恢复策略
- [GitHub 同步](github-sync.md) —— 通过 GitHub 仓库实现内容备份与双向编辑
- [自动化与 API](automation-and-api.md) —— 把上述操作脚本化
- [API 参考（英文）](../API.md)
