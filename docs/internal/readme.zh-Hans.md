# Jant - 产品设计文档

**一句话**：像 Threads, Tumblr 一样丝滑的个人轻博客系统。

> **Jant** = Jantelagen（詹代法则）缩写
> j 强调低调、去社交化的个人表达
> 简单低摩擦的发布体验

## 1. 产品定位

**核心特征**：

- 单博客，单作者
- 三种内容格式（Note, Link, Quote）类似 Tumblr
- Thread（帖子串）——把想法串联成连贯的对话
- Collection（合集）——把完整 Thread 组织成主题合集
- 可定制的颜色方案和字体主题
- 多语言支持（英文、简体中文、繁体中文）
- 极简部署（Cloudflare Workers，一键启动）

---

相关实现设计：

- [Node / Docker 运行时设计](./node-runtime-design.zh-Hans.md)
- [Site-aware Core 设计](./site-aware-core.md)
- [Site-aware Core 实施计划](./site-aware-core-implementation-plan.md)
- [Site-aware 运维边界设计](./site-aware-operations.md)
- [Postgres 支持计划](./postgres-support-plan.md)
- [身份模型设计](./identity-model.md)

## 2. 内容模型

### 2.1 Format（格式）

系统固定 3 种，不可增删。每种对应不同的编辑器形态和用户意图。

| Format    | 用户意图     | 专属字段             | 示例                        |
| --------- | ------------ | -------------------- | --------------------------- |
| **note**  | 我创造的内容 | —（纯通用字段）      | 短想法、长文、图片、AI 对话 |
| **link**  | 我指向的内容 | `url`（必填）        | 分享好文、推荐工具、YouTube |
| **quote** | 我引用的内容 | `quote_text`（可选） | 名言警句、书摘、截图式引用  |

**通用字段**（所有 format 共享）：

| 字段        | 说明                                                 |
| ----------- | ---------------------------------------------------- |
| `title`     | 可选。Note 中为文章标题；Link 中为链接描述           |
| `url`       | Link 中为分享的链接（必填）                          |
| `body`      | 可选正文，TipTap JSON 格式（ProseMirror 结构化文档） |
| `body_html` | 写入时由 body 渲染生成，读取时直接使用，避免重复计算 |
| `media`     | 可选媒体，图片/视频/音频可混合上传                   |
| `rating`    | 可选评分，1-5 整数                                   |

**Quote 对外字段**：

| 字段          | 说明                 |
| ------------- | -------------------- |
| `quote_text`  | 引文本身             |
| `source_name` | 引文来源或署名       |
| `source_url`  | 引文出处链接（可选） |

说明：对外 API、导入导出协议使用 `sourceName/sourceUrl` 或 `source_name/source_url`。当前内部存储层仍可复用 `title/url` 映射 quote attribution，但这属于内部实现，不应直接暴露给外部协议。

**设计理念**：三种 format 覆盖内容的三种来源——我创造的、我指向的、我引用的。Note 有标题时按文章样式渲染，无标题时按短帖子渲染，不需要独立的 article 类型。图片、视频作为任何 format 的通用媒体能力，不需要独立的 image 类型。Rating 是通用字段，任何帖子都可以评分，不需要独立的 review 类型。所有细分分类的需求交给合集。

### 2.2 Page（独立页面）

与 Post 平级的独立内容类型，单独存储。

- 不出现在时间线和 RSS
- 不属于任何合集
- 没有 featured / rating / format / pinned 概念
- 有 `status` 字段（`draft` / `published`），与 Post 一致
- 有固定 URL：`/{slug}`，用户必须自定义 slug，仅支持单级
- 在 `/settings` 后台创建和管理
- 同样存储 `body` 和 `body_html`

**示例**：`/about`、`/now`、`/uses`

### 2.3 Status、Featured & Pinned

| 字段       | 说明                                   |
| ---------- | -------------------------------------- |
| `status`   | `draft`（草稿）/ `published`（已发布） |
| `featured` | 布尔值，独立于 status，标记精选内容    |
| `pinned`   | 布尔值，置顶帖子，显示在时间流最顶部   |

**规则**：

- 默认发布 = published + 不 featured + 不 pinned
- 只有 published 的帖子可以标记为 featured 或 pinned
- 置顶帖子最多 3 条，之间按 created_at 倒序
- `status` 使用字符串而非布尔值，预留 `scheduled` 等未来扩展

**设计理念**：默认 published 但不 featured。减少发布焦虑——随手发的东西可以随时发布，只有主动标记精选的内容才进精选视图。

### 2.4 Thread（帖子串）

**场景**：写着写着内容变长，想拆成多条但保持连贯。

**交互**：

- 发布时可选择「回复」某条帖子
- 回复会形成链式结构
- 首页 timeline 中，Thread 会内联预览最近的回复

**规则**：

- Thread 内所有帖子继承 root 的 status 和 visibility（featured 独立设置，不继承）
- 删除 root = 整个 Thread 软删除
- 删除中间帖 = 子帖保留

### 2.5 Collection（合集）

**场景**：把完整 Thread 组织成主题合集。合集同时承担「子类型」的分类职责——用户通过合集来区分书评、影评、产品推荐等，而非通过内容类型。

**示例**：

- `/reading` - 读过的书（Link + rating）
- `/movies` - 看过的电影（Link + rating）
- `/tools` - 好用的工具（Link）
- `/ai-chats` - AI 对话记录（Note）

**规则**：

- 一个 Thread 可以属于多个合集（多对多关系，通过 `thread_collection` 关联表实现）；Root 和所有 Child 共享同一份归属
- 合集有名称、描述和图标
- 合集有自定义排序方式（最新/最早/评分最高/评分最低）
- 合集有自定义 slug，地址为 `/{slug}`，创建时根据名称自动生成，用户可修改
- 合集有 `position` 字段，后台支持拖拽排序
- 合集之间可以插入分隔线（保存在统一的 `collection_directory_item` 排序表里），用于在列表页分组
- 不预设任何合集，首次使用时引导创建

### 2.6 Media（媒体）

- 所有 format 都支持媒体
- 图片、视频、音频可混合上传
- 图片上传时客户端预处理：EXIF 方向校正、缩放、隐私元数据剥离、WebP 转换
- 服务端存储到 R2 或 S3 兼容存储，生成 blurhash 用于加载占位

### 2.7 Link 富媒体渲染

Link 格式的帖子，后端根据 URL 在 API 返回时计算渲染信息（不入库）：

- 识别 YouTube、Bilibili、Spotify、Twitter 等平台
- 返回 embed URL、缩略图等渲染所需数据
- 支持各平台多种 URL 变体（标准链接、短链接、移动端链接）
- 新增平台只需后端加一条 URL 匹配规则，无需修改数据模型
- 不认识的 provider 自动 fallback 到普通链接展示

**渲染优先级**（从上到下）：Embed → Body → Media

---

## 3. 用户体验

### 3.1 设计理念

**参考**：Pika.page 的简洁 + Threads.net 的丝滑

**关键词**：

- **极简**：大量留白，内容为王。单栏布局，无侧边栏
- **流畅**：所有状态变化都有动画
- **移动优先**：单栏布局，桌面端窄栏居中
- **即时反馈**：骨架屏、加载状态

### 3.2 前台布局

单栏设计，无侧边栏，参考 Pika.page 的简洁风格。顶部导航栏 + 帖子流。

**导航栏**：作者名在左，nav_items 链接和搜索在右。典型配置：

```
作者名       About  Featured  Archive  Collections  📡  🔍
```

- 导航链接由用户通过 nav_items 自定义配置，支持两种类型：`link`（任意 URL）、`system`（系统内置：RSS、Settings、Collections、Archive）
- 🔍 点击弹出搜索弹窗
- 登录后导航栏显示 Settings 链接；未登录时显示 Sign in
- 未登录的博主直接访问 `/signin` 进入登录页

### 3.3 首页 Timeline

- 首页展示所有 published 帖子；精选内容固定在 `/featured`
- 置顶帖子（pinned）显示在日期分组之前
- 帖子卡片根据 format 和内容自动适配不同样式
- 基于页码分页加载更多
- 登录后顶部出现发帖框

### 3.4 发帖

弹窗形式，参考 Threads。

**核心原则**：

- 默认就是最简单的文本输入（Note 模式）
- 标题输入框始终可见但以灰色小字弱化
- 通过工具栏图标切换 format，编辑器形态随之变化
- 📎 媒体和 ⭐ 评分作为可选的通用能力
- 📂 合集选择集成在发布框内，降低使用门槛
- 草稿逻辑参考 Threads / Bluesky：发布按钮旁有 drafts 图标，有内容时点击 = 存为草稿并清空，空输入框时点击 = 展开草稿列表
- 发布默认 = published + 不 featured，精选和置顶通过发布按钮下拉勾选

### 3.5 搜索

弹窗形式。点击导航栏 🔍 弹出搜索框 + 实时结果。

### 3.6 Archive

独立页面，承担所有筛选功能。使用 query parameter 进行筛选：

- `/archive` — 全部
- `/archive?format=note` — 仅 Note
- `/archive?format=link` — 仅 Link
- `/archive?format=quote` — 仅 Quote
- `/archive?featured=true` — 仅精选
- 支持组合：`/archive?format=note&featured=true`
- 按时间浏览（按月份分组）

首页保持干净，所有高级筛选收到 Archive 里。

### 3.7 合集页面

`/collections` 展示所有合集的列表页，点击进入单个合集的 Thread 列表（`/{slug}`）。每个结果展示完整 Thread，不保留逐 Post 收藏语义。

### 3.8 首次使用（Onboarding）

首次访问时自动引导到设置页面，收集管理员账号（邮箱 + 密码）和站点语言。完成后即可开始发布。

### 3.9 动画规格

- **时长**：150-300ms
- **缓动**：ease-out
- **场景**：页面切换（淡入 + 轻微上移）、新内容加载（骨架屏）、按钮点击（轻微缩放）、展开/收起（高度动画）

---

## 4. 导航系统

### 4.1 nav_items

站点顶部导航完全由用户自定义，支持拖拽排序。

**类型**：

- `link` — 任意 URL（`/collections`、`/featured`、`/archive`、`/reading`、外部链接，都是 link）
- `system` — 系统内置链接（RSS `/feed`、Settings `/settings`、Collections `/collections`、Archive `/archive`），label 可自定义

**后台管理**（`/settings/navigation`，设置的导航子页面）：

- 已添加到导航的项目（link、system 类型混合），可拖拽排序
- 支持添加任意链接、系统链接
- 支持内联编辑 label 和 URL

---

## 5. 信息架构

### 5.1 URL 设计

> URL 是产品的一部分。应该简洁、美观、有意义。

帖子使用 slug 作为 URL（如 `/{slug}`）。Slug 由标题自动生成（通过 `lib/slug.ts`），或生成随机字母数字 ID（通过 `lib/nanoid.ts`，长度由 `SLUG_ID_LENGTH` 环境变量控制，默认 5）。自定义路径覆盖通过 `path_registry` 表管理。合集使用 `/{slug}`，组合合集使用 `/collections/{slug1}+{slug2}`。

### 5.2 前台路由

| URL                        | 内容                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `/`                        | 首页（展示最新帖子）                                               |
| `/latest`                  | 302 重定向到 `/`                                                   |
| `/featured`                | 精选帖子                                                           |
| `/{slug}`                  | 单条帖子（slug 自动生成或自定义）                                  |
| `/{slug}`                  | 单个合集 Thread 列表                                               |
| `/collections/{slug}`      | 组合合集 Thread 列表                                               |
| `/collections`             | 合集列表页                                                         |
| `/archive`                 | 归档（支持 ?format= &featured= 筛选）                              |
| `/search`                  | 搜索                                                               |
| `/feed`                    | RSS 2.0 站点主 Feed（默认精选，可在设置中切换为 Latest）           |
| `/feed/atom.xml`           | Atom 站点主 Feed（默认精选，可在设置中切换为 Latest）              |
| `/latest/feed`             | RSS 2.0 Latest Feed（公开帖子，支持 `?format=` 筛选）              |
| `/featured/feed`           | RSS 2.0 Featured Feed（仅精选帖子）                                |
| `/archive/feed`            | RSS 2.0 全量归档 Feed（含 `Hidden from Latest`，支持归档筛选参数） |
| `/feed/latest`             | 旧地址，`308` 永久跳转到 `/latest/feed`（保留 query）              |
| `/feed/featured`           | 旧地址，`308` 永久跳转到 `/featured/feed`                          |
| `/{slug}/feed`             | 单个合集的 RSS Feed                                                |
| `/collections/{slug}/feed` | 组合合集的 RSS Feed                                                |
| `/sitemap.xml`             | 自动生成的站点地图                                                 |

### 5.3 后台路由

| URL                     | 功能                         |
| ----------------------- | ---------------------------- |
| `/settings`             | 设置首页                     |
| `/settings/general`     | 通用设置（名称、描述、语言） |
| `/settings/avatar`      | 头像设置                     |
| `/settings/navigation`  | 导航管理                     |
| `/settings/color-theme` | 颜色主题                     |
| `/settings/font-theme`  | 字体主题                     |
| `/settings/custom-css`  | 自定义 CSS                   |
| `/settings/custom-urls` | 自定义 URL 与重定向          |
| `/settings/api-tokens`  | API Token 管理               |
| `/settings/account`     | 密码修改                     |

### 5.4 重定向与路径注册

**重定向**：支持 301（永久）和 302（临时）重定向。两种来源：

- **自动**：Post 或合集修改 slug 时，系统自动为旧路径创建 301 重定向
- **手动**：用户在后台（`/settings/custom-urls`）自行创建，用于短链接、旧站迁移等场景

**自定义 URL**：`path_registry` 表管理所有自定义路径，支持帖子别名、合集别名和重定向。确保 slug 在帖子和自定义路径之间不会冲突。

---

## 6. RSS 与 SEO

**Feed**（主 Feed + 显式 Feed）：

- `/feed` — 站点主 Feed。默认输出精选帖子，也可以在设置中改为 Latest
- `/feed/atom.xml` — 主 Feed 的 Atom 版本
- `/latest/feed` — Latest 公开帖子（支持 `?format=note` 等格式筛选）
- `/featured/feed` — 仅精选帖子
- `/archive/feed` — 全量归档（含 `Hidden from Latest`，支持 `?year=`、`?format=`、`?collection=`、`?media=` 等归档筛选）
- 旧地址 `/feed/latest`、`/feed/featured` 会 `308` 永久跳转到上面的规范地址，老订阅者不受影响
- `/{slug}/feed` — 单个合集的 RSS Feed，按 Thread 活动时间倒序
- `/collections/{slug}/feed` — 组合合集的 RSS Feed，按 Thread 活动时间倒序

**Sitemap**：自动生成，包含所有公开帖子和页面。

**SEO**：Open Graph、Twitter Cards、JSON-LD 结构化数据、microformats2 语义标记。

---

## 7. 主题系统

### 7.1 颜色主题

内置 12 种颜色方案：linen, dune, clay, parchment, ink, stone, mist, slate, ember, moss, iris, nocturne。不选择时使用 BaseCoat 默认样式。

通过 CSS 变量实现，默认跟随系统的 light/dark mode，也可在 `/settings/color-theme` 强制为 Light 或 Dark。使用 `:root:root` 与 `data-theme-mode` 相关选择器确保主题覆盖优先级高于 BaseCoat 默认值。

### 7.2 字体主题

内置 6 种字体方案，除字体组合外也会一起调整标题、正文、标签的排版节奏：

- **default** — Notebook，温和衬线标题 + 清爽无衬线正文
- **system-sans** — System Sans，平台默认感，紧凑中性
- **humanist-sans** — Humanist Sans，更柔和的人文无衬线，节奏稳定
- **modern-editorial** — Newsroom，News Cycle 标题 + Newsreader 正文
- **literary** — Library，Literata 全衬线，适合长文和引用
- **geometric** — Signal，高对比无衬线，标题更紧、标签更响

### 7.3 自定义 CSS

`/settings/custom-css` 页面支持用户自定义 CSS，可覆盖任何 CSS 变量或样式。

## 8. 配置系统

配置采用三级优先级：DB > ENV > Default（用户可配置字段），ENV > Default（环境专属字段）。

**用户可配置**（后台设置）：

| 字段               | 说明                                           | 默认值     |
| ------------------ | ---------------------------------------------- | ---------- |
| `SITE_NAME`        | 站点名称                                       | `Jant`     |
| `SITE_DESCRIPTION` | 站点描述                                       | 自动生成   |
| `SITE_LANGUAGE`    | 站点语言（en, zh-Hans, zh-Hant）               | `en`       |
| `MAIN_RSS_FEED`    | `/feed` 默认输出（featured / latest）          | `featured` |
| `TIME_ZONE`        | 时区（IANA 标识，例如 `UTC`、`Asia/Shanghai`） | `UTC`      |
| `SITE_FOOTER`      | 自定义页脚                                     |            |
| `NOINDEX`          | 是否禁止搜索引擎索引                           |            |

**环境配置**（`wrangler.toml` / `.dev.vars`）：

| 字段                      | 说明                               |
| ------------------------- | ---------------------------------- |
| `AUTH_SECRET`             | 认证密钥（必填）                   |
| `SITE_ORIGIN`             | 单站点模式下可选的公开 origin 覆盖 |
| `SITE_PATH_PREFIX`        | 单站点模式下的公开路径前缀         |
| `MAIN_RSS_FEED`           | 主 RSS Feed（featured / latest）   |
| `PAGE_SIZE`               | 默认分页大小（默认 50）            |
| `SEARCH_PAGE_SIZE`        | 搜索页分页覆盖                     |
| `ARCHIVE_PAGE_SIZE`       | 归档页分页覆盖                     |
| `R2_PUBLIC_URL`           | R2 公开 URL（CDN 直接访问）        |
| `IMAGE_TRANSFORM_URL`     | 图片转换 URL                       |
| `STORAGE_DRIVER`          | 存储驱动（r2 / s3）                |
| `S3_*`                    | S3 兼容存储配置                    |
| `SLUG_ID_LENGTH`          | 随机 slug 长度（默认 5）           |
| `UPLOAD_MAX_FILE_SIZE_MB` | 上传文件大小上限（MB，默认 1024）  |

## 9. 技术选型

- **部署**：Cloudflare Workers
- **框架**：Hono + Hono JSX
- **交互**：Datastar（Hypermedia，服务端渲染 + 增量更新） + Lit（Web Components）
- **样式**：Tailwind CSS v4 + BaseCoat 组件
- **数据库**：D1 + Drizzle ORM
- **存储**：Cloudflare R2 或 S3 兼容存储
- **认证**：better-auth
- **多语言**：Lingui（编译时消息提取）
- **校验**：Zod
- **语义标记**：microformats2
