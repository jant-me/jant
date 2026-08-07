# 多语言内容功能 — 实现设计文档

状态：**设计定稿，待实现**
日期：2026-08-06（同日完成代码库对照评审并修订：路由挂载方式、去表级 CHECK、
物化 SQL 的 site 界定、语言集合不变量、设置键 DB-only、公开 catalog 声明）

> 本文档面向实现者，给出的是最终设计。§14 记录了替代方案与不采用的理由，
> 实现时不要重新引入。若发现本文档与代码现实冲突，先判断哪边正确，
> 再更新错的那边（见 AGENTS.md「Reference」节）。

---

## 0. 一页摘要

给双语博客作者（典型场景：中文 + 英文受众）提供**按语言过滤的平行浏览视图**：

- `post` 表加 `language`（BCP 47）和 `translation_group_id` 两列；
- **语言前缀只加在列表面上**（`/en`、`/en/archive`、`/en/feed`、`/en/{col}`），
  **文章 permalink 永远是 `/{slug}`，不编码语言** —— 这是本设计与
  Hugo/Astro 式方案的最大区别，也是它便宜的原因：`path_registry` 不改、
  换主语言不迁移 URL、开关双向无损；
- 多语言是**高级功能，默认关闭**：关闭时 compose 无语言选择器、无 `/xx`
  路由、`language` 列不写入；
- 翻译关联用**共享翻译组 ID**（Hugo `translationKey` 模型），挂在 thread root 上；
- 语言检测**只做建议**（compose 预填 + API/bot 兜底），落库永远是明确值；
- 开启时把存量文章**一次性物化为主语言**（带显式确认 UI）。

---

## 1. 目标与产品原则

**目标**：单作者双语（或多语）博客，不同语言的受众各有独立的首页、归档、
订阅源和 collection 视图。需求来自真实用户（同时有中文和英文读者的作者）。

**产品原则**：

1. **高级功能，不打扰单语作者** —— 必须由作者在设置里主动开启；关闭状态下
   界面上没有任何多语言痕迹。
2. **不要求对称** —— 90 篇中文 + 5 篇英文是正常状态；绝大多数文章没有译本
   是正常状态；某集合在某语言下为空是正常状态。明确不做：翻译覆盖率提示、
   催促补译、任何逼近对称的机制（Polylang 的反面教训）。
3. **数据模型按 N 语言设计，UI 按双语优化** —— 语言列 + 翻译组天然是 N 元的，
   硬编码"双语"不省任何代码；UI 复杂度靠「主语言 + 添加其他语言」的结构控制。
4. **流按语言分，骨架共用一套** —— 内容流（首页/归档/feed/搜索/collection 成员）
   按语言过滤；站点骨架（导航、站名、页脚、collection 目录与标题描述、关于页）
   共用一份，**用主语言书写**（不是英文 —— 中文作者的导航该是中文的）。
5. **检测是建议，不是权威**（Mastodon 与 Bluesky 的共同结论）—— 检测只预填
   选择器，落库的永远是作者确认过的明确值；渲染时永不检测。

---

## 2. 核心决定一览

| #   | 决定                                                                                                                         | 详见       |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D1  | 文章 permalink 不带语言前缀；前缀只用于列表面                                                                                | §4         |
| D2  | `path_registry` 保持全局唯一命名空间，不按语言分                                                                             | §4         |
| D3  | 换主语言 = 视图换座位，零数据迁移、零 URL 变化                                                                               | §9.3       |
| D4  | 翻译组：共享 `translation_group_id`，只挂 thread root                                                                        | §7         |
| D5  | 渲染语言逐帖、路由语言取 thread root                                                                                         | §7.3       |
| D6  | 开启前 `language` 列一律 NULL 且不写入                                                                                       | §10.1      |
| D7  | 开启时显式确认 + 一次性物化 NULL → 主语言                                                                                    | §10.2      |
| D8  | 「添加译本」不预建草稿不预生成 slug，提交时原子建组                                                                          | §7.2       |
| D9  | 允许关闭多语言；旧 `/xx/*` 剥前缀 301 回根                                                                                   | §9.4       |
| D10 | 语言设置集中到独立「设置 → 语言」页（内容语言 + 界面语言 + 多语言）；主语言 = 现有 `SITE_LANGUAGE`，单一数据源               | §9.1       |
| D11 | 语言码存储用 BCP 47 规范形式（`zh-Hans`），URL 前缀全小写（`/zh-hans`）                                                      | §11.1      |
| D12 | 语言前缀不做静态保留字；添加语言时动态检查 `path_registry` 冲突                                                              | §11.2      |
| D13 | slug 主路径不感知语言；冲突时非主语言帖先试 `{base}-{lang}` 候选                                                             | §11.3      |
| D14 | 不做全语言合并 feed；`/feed/all` 是无关的 legacy redirect，不动                                                              | §5         |
| D15 | 检测器手写字符集投票（~2KB），不引 franc/cld3                                                                                | §6         |
| D16 | Collection 目录列出全部集合，不按视图语言隐藏；详情页成员按语言过滤                                                          | §5         |
| D17 | 删除 `CJK_SERIF_FONT` 设置，字体 profile 全部从语言推导                                                                      | §12        |
| D18 | Setup 显式加「内容语言」一项（浏览器语言预填）；界面语言、多语言不进 setup                                                   | §9.5       |
| D19 | `/xx` 路由**始终挂载**，per-request 判定是否启用，未启用 fall-through 到 catch-all                                           | §4.4       |
| D20 | 不加表级 CHECK：root-only 由 service 保证，一组一语一篇由 partial unique index 保证                                          | §3.1       |
| D21 | `MULTILINGUAL_ENABLED` / `ADDITIONAL_LANGUAGES` 均 DB-only（无 `envKeys`、无 `editor`），只能经语言设置页的 service 编排写入 | §3.2       |
| D22 | 语言集合不变量：帖子语言 ⊆ {主语言} ∪ 其他语言。移除语言仅零帖时允许；换主语言自动互换列表                                   | §9.1、§9.3 |
| D23 | 公开页 Lingui catalog 维持 baseLocale（英文），不随视图语言切换；新增公开文案以英文源文案交付                                | §5         |

---

## 3. 数据模型

### 3.1 post 表新列（SQLite 与 Postgres **两份 schema 必须同步**）

```
language              TEXT NULL   -- BCP 47 规范形式（"zh-Hans" / "en"）。
                                  -- NULL 仅存在于多语言开启之前（见 §10）。
translation_group_id  TEXT NULL   -- TypeID，前缀 tgr_（在 src/lib/ids.ts 注册）。
```

约束 —— **不加表级 CHECK**（D20）：

```sql
-- 一个翻译组里一种语言只能有一篇（partial unique index）。
-- site_id 前缀与库内索引惯例一致，且 (site_id, translation_group_id)
-- 前缀直接服务「列出组内成员」查询，无需第二个索引。
CREATE UNIQUE INDEX uq_post_site_translation_group_language
  ON post (site_id, translation_group_id, language)
  WHERE translation_group_id IS NOT NULL;
```

「翻译组只能挂在 thread root 上」（`translation_group_id IS NULL OR
thread_id = id`）**由 service 层保证**，不加表级 CHECK。原因：SQLite 不支持
`ALTER TABLE ADD CHECK`，drizzle-kit 会生成整表重建迁移（建新表 → 拷贝 →
DROP 旧表 → RENAME），而 `post` 表挂着 FTS 同步触发器 `post_ai` / `post_ad` /
`post_au`（`0003_fts_site_aware.sql`）—— DROP 旧表会**静默删掉触发器**，搜索
索引从此停更且无任何报错（0002/0003 那次站点化重建正是为此做过整套触发器
编排）。纯加可空列 + 建索引不触发重建，迁移风险归零。写入
`translation_group_id` 的只有本设计新增的少数 service 方法（建组 / 入组 /
退组 / `translationOfId` 创建），在这些方法里校验目标是 thread root
（`thread_id === id`），违反抛 DomainError。将来若因其他原因重建 `post` 表，
可顺路补上该 CHECK（并在同一迁移里重建 FTS 触发器）。

翻译组无 FK 目标（组 ID 只是共享字符串），**组内成员同站**同样由 service
层在关联操作时校验，需测试覆盖。

索引 —— **v1 不为语言过滤新增索引**：

- 热路径已有精准 partial index（Latest 走
  `idx_post_site_root_published_activity (site_id, last_activity_at, id)
WHERE root AND published`，归档 / featured / 草稿各有一条）。`language = ?`
  作为**残余谓词**附在这些索引扫描上 —— 索引照常驱动排序，语言在回表时过滤。
  这与现状的 `format` / `media` / `title` 归档过滤器同一模式（它们也全是
  残余谓词，无专属索引）。
- 量级依据：单作者 microblog（10²–10⁴ 行），残余过滤毫秒级；最坏情况
  （95/5 语言比的少数语言视图翻页）多走约 20 倍索引条目，仍无感。
- **升级路径**（仅当实测少数语言视图翻页变慢时）：把 `language` 插进热路径
  partial index 的 `site_id` 之后 —— 如 `(site_id, language, last_activity_at,
id) WHERE root AND published` —— 等值前缀 + 排序列同时服务多数与少数语言；
  **原索引保留**，继续服务关闭态与无语言过滤的查询。纯追加迁移，随时可补。
  不做泛用的 `(site_id, language, status, published_at)`：它服务不了各表面
  不同的排序列。

迁移注意（AGENTS.md 硬约束）：

- SQLite：改 `src/db/schema.ts` → `mise run db-schema-generate`；
- Postgres：改 `src/db/pg/schema.ts` → `mise run db-schema-generate-pg`，
  生成失败则手写迁移并更新 `migrations/pg/meta/_journal.json`；
- 追加式，绝不改已有迁移文件；
- 本迁移只允许 `ADD COLUMN` 与 `CREATE INDEX`，**不得出现 `post` 表重建**
  （见上方 CHECK 说明）；生成后人工检查迁移 SQL 确认；
- `schema-bundle.ts` 把 pg schema 强转成 sqlite schema 的类型，两边列必须完全一致；
- pg 的 `search_text` / `search_document` 生成列用 `'simple'` regconfig，
  **不要动** —— 搜索保持语言无关，按视图语言只做过滤（见 §5）。

### 3.2 settings 新键（走 `CONFIG_FIELDS`，但 DB-only、不进通用编辑面）

```
MULTILINGUAL_ENABLED   "true"/"false"，默认 "false"
SITE_LANGUAGE          （已存在）多语言开启后即「主语言」，见 §9.1，不新建字段
ADDITIONAL_LANGUAGES   逗号分隔的规范 BCP 47 tag（如 "en,ja"），默认 ""；
                       有序，顺序即切换器顺序
```

两个新键的注册方式（D21）：

- **省略 `envKeys`** → 不可经环境变量注入。否则 self-host 用户设
  `MULTILINGUAL_ENABLED=true` 环境变量即可绕过 §9.2 的确认与物化，存量 NULL
  帖从根视图整体消失；`ADDITIONAL_LANGUAGES` 走 env 则绕过 §11.2 的前缀
  冲突检查。
- **省略 `editor`** → 通用 Config Editor 与 `PUT /api/settings` 一并拒绝
  （`isEditableSettingKey` 要求 `"editor" in field`，机制现成，见
  `lib/api-settings.ts`）。写入只有一条路：语言设置页背后的 settings service
  编排方法（§15.2）。可加 `configEditorLink` 指向语言页，保留设置搜索的
  可发现性。
- 存储格式选**逗号分隔**而非 JSON 数组：tag 永不含逗号，免转义、可读、保序；
  每个 token 写入时过 `normalizeContentLanguage()`。不做 per-language boolean
  键（`ADDITIONAL_LANGUAGE_EN` 之类）：`CONFIG_FIELDS` 是静态注册表，BCP 47
  是开放集合无法逐 tag 预注册，且布尔键丢失切换器顺序（见 §14）。

### 3.3 语言值语义

| 值                        | 含义           | 行为                                                             |
| ------------------------- | -------------- | ---------------------------------------------------------------- |
| `en` / `ja` / `zh-Hans` … | 明确语言       | 只在该语言视图出现                                               |
| `NULL`                    | 多语言尚未开启 | 公开路径永远读不到（消费代码全部在开关后面），开启瞬间被物化清零 |

---

## 4. URL 与路由规范

### 4.1 布局

```
/                /archive        /feed        /latest   /featured
/search          /collections    /{col}                    ← 主语言视图（现状 URL 全部不变）

/en              /en/archive     /en/feed     /en/latest  /en/featured
/en/search       /en/collections /en/{col}                 ← 英文视图

/{slug}                                                    ← 所有文章，语言中立，永久
```

规则：

- **前缀 = `ADDITIONAL_LANGUAGES` 里语言 tag 的全小写形式**（`/en`、`/zh-hant`）。
  主语言永远无前缀（根就是主语言的前缀，只不过它是空的）。
- **文章 permalink 永远只有 `/{slug}`**。`hreflang` 和 `<html lang>` 负责表达
  语言，SEO 不需要路径编码语言（Mastodon/Bluesky/Tumblr/Ghost 皆如此）。
- `/xx/*` 是一层**只读的视图语言包装**：复用现有 handler，往 context 里放
  `viewLang`，不产生任何 `path_registry` 写入。

### 4.2 `/xx/{slug}` 的对称解析规则

`/en/{slug}` 走与根 catch-all 相同的 `path_registry` 解析：

- 命中**文章** → `301` 到规范地址 `/{slug}`；
- 命中 **collection** → 渲染该 collection 的英文过滤视图；
- 命中 redirect 行 → 照常跟随（跟随后再套上面两条）；
- 未命中 → 404。

### 4.3 主语言前缀别名

`/zh-hans`（= 当前主语言的前缀）→ `301` 到 `/`，其子路径同理剥前缀。一行逻辑。

### 4.4 挂载方式：始终挂载 + per-request 判定（D19）

「开关关闭时不挂载」在本架构下**不成立**：`createApp()` 在模块加载时执行一次
（`export default createApp()`），挂载表是静态的；而 `MULTILINGUAL_ENABLED` /
`ADDITIONAL_LANGUAGES` 是 `withConfig()` per-request 加载的站点配置，且 hosted
模式下同一 app 实例服务多个站点、各站语言集不同 —— 静态挂载表和
`/:lang{...}` 正则都无法编码 per-site 语言集。

实际写法：语言前缀路由组**始终挂载**在 `pageRoutes` catch-all 之前，handler
内 per-request 判定首段：

- 是该站点**当前启用**的语言前缀（多语言开启中）→ 注入 `viewLang`，走视图；
- 是**曾配置过**的语言前缀（多语言已关闭，`ADDITIONAL_LANGUAGES` 保留）→
  剥前缀 301 回根对应物（§9.4，保护订阅器与外链）；
- 其余 → `await next()`，fall-through 到 `path_registry` catch-all
  （slug 恰为 `en` 的既有文章照常解析，与关闭态零冲突）。

---

## 5. 各公开表面的行为

| 表面                           | 行为                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首页 / latest / featured       | 按视图语言过滤（filter 见 §15.2）；pinned/featured 同样过滤。**置顶/精选没有 per-language 设置**：`pinnedAt` / `featuredAt` / `thread_collection.pinnedAt` 都挂在（单语言的）帖子或 thread 行上，语言过滤后集合天然按语言分割 —— 置顶中文帖对 `/en` 无影响，想两个视图都有置顶就各置顶一篇（如互为译本的两篇）。符合原则 2，不对称是常态 |
| 文章页                         | 语言中立 URL；`<html lang>` = 该帖 `language`；有译本时页面出「Also available in 中文 →」一行 + head 里 hreflang alternates                                                                                                                                                                                                              |
| 归档 `/archive`                | 按视图语言过滤；现有 `format/media/title/...` 参数照旧；**不新增公开 `lang=` query 参数**（视图语言由路径前缀表达）                                                                                                                                                                                                                      |
| 搜索 `/search`                 | **索引共用不分语言**（trigram/FTS 本就语言无关），结果按视图语言过滤                                                                                                                                                                                                                                                                     |
| Collection 目录 `/collections` | **列出全部集合，不按视图语言隐藏**（目录属于骨架）；某集合在该语言下没有成员也照常列出                                                                                                                                                                                                                                                   |
| Collection 详情 `/{col}`       | 一份 collection 对象，**不加 language 字段**；成员按视图语言过滤（成员关系在 `thread_collection`，按 thread root 记，与路由语言取 root 对齐）。空态必须给出路：「这个集合还没有英文内容。[查看中文版 →]」                                                                                                                                |
| Feed `/feed`、`/xx/feed`       | 按视图语言过滤；Atom `xml:lang` / RSS `<language>` = 视图语言。**不做全语言合并 feed**（双语读者本来就按语言分群）。`/feed/all` 是与本功能无关的 legacy 308 → `/latest/feed`，**保留不动**                                                                                                                                               |
| Sitemap                        | 文章 URL 语言中立，**只列一次，结构不变**；对有翻译组的文章补 `xhtml:link rel="alternate" hreflang`                                                                                                                                                                                                                                      |
| 公开 JSON API `/api/public/*`  | 机器表面：新增 `lang` 过滤参数（单词小写，符合参数规范）                                                                                                                                                                                                                                                                                 |
| 导航 / 站名 / 页脚 / 关于页    | 共用一套，主语言书写，**不分语言**（骨架规则）                                                                                                                                                                                                                                                                                           |
| 语言切换器                     | 开启后出现在站点导航。规则见下表；**永不灰掉、不弹提示**                                                                                                                                                                                                                                                                                 |

切换器语义 ——「带我去这个语言的站」，切的是视图不是当前文章：

| 当前位置                  | 点「English」去哪       |
| ------------------------- | ----------------------- |
| 有英文译本的文章          | → 那篇译本              |
| 无译本的文章              | → `/en` 首页            |
| 首页 / 归档 / 集合 / 搜索 | → 同一表面的 `/en` 版本 |

**公开 UI 文案语言（D23）**：现有公开表面强制 baseLocale（英文）catalog ——
`i18n/middleware.ts` 只对 `/settings`、`/dash` 激活站点语言 catalog，为避免
Lingui 消息 ID 碰撞把设置译文泄漏进公开页头。本功能**维持该现状**：切换器、
「Also available in …」、collection 空态等新增公开文案以英文源文案交付，即使
在 `/zh-hans` 视图下也渲染英文 —— 与既有公开 UI（导航 Latest / Featured 等）
一致，是设计意图。本文档中的中文示例文案仅为示意。`viewLang` 只驱动
`<html lang>`、feed 语言标记、字体 profile 与内容过滤，**不驱动 catalog**。

---

## 6. 语言的确定（检测器）

- **时机**：发布时检测并存库，渲染时永不检测。
- **落库永远是明确值**：默认预填来自检测建议（有把握时）或主语言 / 作者
  上次所用语言；作者可在 compose 改；API / Telegram bot 等绕过 compose 的
  路径由**服务端**跑同一检测器静默兜底填值。
- **只在站点已配置的语言集合内做选择**（zh+en 站不会检测出 ja；日文引文这类
  边缘情况回落主语言，作者可手改）。
- **实现**：手写字符集投票器（约 2KB），同构 lib：
  - 客户端仅在已登录 compose 界面加载 → 公开页面零字节开销；
  - 服务端供 API / bot 兜底；
  - 可靠度：Hangul（U+AC00–D7A3）~100%；假名（U+3040–30FF）~100%；
    简繁靠特有字投票（国学说这时会对后 ↔ 國學說這時會對後），一句话以上基本必中；
    纯共享汉字的极短文本 → 模糊，回落默认值。
  - **检测器永远不返回空值或语言集合之外的值**。
- 不引入 franc / cld3。

---

## 7. 翻译组

### 7.1 模型

共享组 ID（`translation_group_id`，TypeID `tgr_`），即 Hugo `translationKey`
模型：N 种语言 N 行，不做两两互链，无方向性；加第三种语言自动与前两种互见。
`UNIQUE(translation_group_id, language)` 保证一组一语一篇。

**翻译的单位是 thread**，root 行记录组 ID（service 层校验保证，见 §3.1）。
独立文章本来就是单帖 thread（`thread_id = id`），一条规则覆盖两种情况。

### 7.2 交互（两条路）

1. **已发布文章操作菜单 → 「添加译本」**：选目标语言 → 打开 compose，
   预填目标语言并携带 `translationOfId`（= 源 thread root 的 ID），正文留给
   作者写。**明确不做机翻。**

   **不预建任何服务端状态**：点击「添加译本」不创建草稿行、不生成 slug、
   不给源帖建组。关闭 compose 即零痕迹（无空草稿、不占 `path_registry`、
   源帖不留单元素组）。**提交时**（存草稿或发布）由 service 原子完成：
   源帖无组则建组 → 新帖入组 → 正常走 slug 生成（此时标题已存在，slug
   质量也更好）。`translationOfId` 的传递与现有 `replyToId` 同构，进
   `ComposeSubmitDetail` 和 `LocalDraft`（本地草稿中途放下再捡起，关联不丢）。

2. **「关联已有文章为译本」**：覆盖"两篇早已各自发布、后来想连起来"的场景。
   被关联方无组则加入对方的组；若组内该语言已占用，按 UNIQUE 冲突报清晰错误。

解除关联：置 NULL；若组内只剩一篇，把最后一篇的组 ID 也清掉（避免悬空单元素组）。

改语言与组的联动：改一篇在组内文章的语言时，若与组内既有语言冲突 →
阻止并报错（文案说清哪篇占了该语言）。

### 7.3 渲染语言 vs 路由语言

同一列数据，两种读法：

|          | 粒度                   | 用途                                               |
| -------- | ---------------------- | -------------------------------------------------- |
| 渲染语言 | 每篇帖子               | `lang` 属性、屏幕阅读器、字体选择                  |
| 路由语言 | 每个 thread（取 root） | 出现在哪个 `/xx` 视图、feed、归档、collection 过滤 |

回复**创建时默认继承 root 的语言**；语言选择器 UI 只出现在 thread root 上
（一个 thread 一种语言是 99% 场景）。从文章菜单改语言时按 thread 整条改
（service 层方法，root + 全部回复）。

---

## 8. Compose 交互

- `MULTILINGUAL_ENABLED = false` → **compose 里没有任何语言 UI**（本功能
  「高级且不打扰」的关键）。
- 开启后：thread root 出现语言选择器，检测建议预填，作者可改。选项 =
  主语言 + `ADDITIONAL_LANGUAGES`，显示名用语言自己的名字（简体中文 / English / 日本語）。
- 提交链路带 `language` 字段：`PostFieldsSchema` → `CreatePost/UpdatePost` →
  service 落库；`ComposeSubmitDetail` / `LocalDraft` 同步加字段（本地草稿
  要能记住选过的语言）。
- 位置建议：per-row 的 post meta 控件（现有 publish date + permalink 那个
  pill/popover）或 publish panel，实现时取交互最顺的一处；只在 root 行渲染。

---

## 9. 设置与生命周期

### 9.1 设置 IA：独立「设置 → 语言」页，集中全部语言设置

新建 设置 → 语言 二级页，**所有语言相关设置只有这一个家**。页面命名用
「语言」而非「多语言」—— 它承载的是内容语言、界面语言这些单语作者也拥有
的设置，多语言只是页内一个区块（叫「多语言」会让单语作者找不到网站语言）。

```
设置 → 语言

  站点
    内容语言      [简体中文 ▾]     ← SITE_LANGUAGE
                                     描述：「读者和搜索引擎看到的语言」
                                     多语言开启后标签变「主语言」，描述改为
                                     「根地址（/、/feed）显示这个语言的内容」，
                                     修改触发 §9.3 确认框
    □ 多语言内容
       为不同语言提供独立的首页、归档和订阅源。
       [开启后展开]  其他语言  [English ×] [+ 添加]

  后台
    界面语言      [跟随内容语言 ▾]  ← DASHBOARD_LANGUAGE
                                     描述：「管理后台的显示语言，只有你能看到」
```

- General 的「Language & Time」区块随之只剩 Time Zone（时间与语言解耦，
  原来的耦合只是排版巧合）。单语作者的 General 变短；「语言」页对他们
  就是两个下拉加一行安静的开关。
- **命名**：站点侧「内容语言」、后台侧「界面语言」—— 区分轴是**谁看到**
  （读者 vs 作者），由分组标题 + 描述行共同表达，不靠字段名单独承担。
  英文源文案保持 "Content language" / "Dashboard language"，中文目录译作
  「内容语言」/「界面语言」。判据：**这个设置改的是读者看到的东西，还是
  作者自己看到的东西。**
- 「主语言」就是 `SITE_LANGUAGE`：单一数据源，不新建字段。消费者 =
  `<html lang>`、RSS `<language>`、字体推导（§12）+（开启后）存量打标值、
  根视图归属。
- 「+ 添加」语言时执行前缀冲突检查（§11.2），冲突则阻止并点名冲突路径。
- 「×」移除语言（与添加对称，D22）：**仅当该语言零帖时允许**。库中仍有该
  语言的帖子（任意状态）→ 阻止并报数量与出路：「还有 12 篇日语文章。先修改
  它们的语言，或保留日语。」零帖时移除无副作用 —— 该语言视图本就为空、
  不存在有意义的外链或订阅者，无需任何 301 机制。这是 §9.3 语言集合不变量
  的一半。

### 9.2 开启流程（含存量确认）

点开「多语言内容」开关 → 确认对话框（不是直接生效）：

```
启用多语言

  主语言        [简体中文 ▾]     ← 预填 SITE_LANGUAGE，可就地修改
  其他语言      [English] [+ 添加]     ← 至少添加一种才能启用

  ⚠ 你已有的 347 篇文章将全部标记为 简体中文。
    如果其中有英文文章，开启后可以在那篇文章的菜单里单独修改语言。

  [标记并启用]        [取消]
```

要点：具体数字（347 篇）；警告行**响应式跟随**主语言下拉的当前值；按钮文案
说清动作（「标记并启用」，不是「确认」）；一句话告知事后纠正路径。
落库打标以对话框最终选定的值为准（不盲信旧 `SITE_LANGUAGE`，它可能从没被
作者主动设置过），确认时写回 `SITE_LANGUAGE`。

### 9.3 开启后改主语言：轻量确认，零迁移

「标签已物化 + permalink 无前缀」使这个操作很轻：**不迁移数据、不动文章 URL、
不重新打标**，只是根视图和前缀视图互换座位。唯一真实影响是列表面语义
（`/feed` 订阅者从此收到新主语言的内容），给描述性确认即可：

```
把主语言改为 English？

  根地址（/、/feed、/archive）将改为显示 English 内容，
  简体中文 移至 /zh-hans。文章地址不受影响。

  [切换]   [取消]
```

**设置写入语义（不变量的另一半，D22）**：确认后一次编排完成 ——
`SITE_LANGUAGE` ← 新主语言；`ADDITIONAL_LANGUAGES` ← 移除新主语言、加入旧
主语言（其余顺序不变）。两步缺一不可：漏掉任何一半，旧主语言的帖子会从所有
视图消失（根视图过滤新主语言，旧主语言又没有前缀视图）。

**语言集合不变量**：库中所有 `post.language` 值 ⊆ {`SITE_LANGUAGE`} ∪
`ADDITIONAL_LANGUAGES`。由三条规则共同维持：改帖语言只能选已配置语言（§8）、
移除语言需零帖（§9.1）、换主语言自动互换（本节）。

多语言关闭时修改「网站语言」维持现状行为（无确认框）。

### 9.4 关闭多语言：允许，且双向无损

**不禁止关闭**（禁止会把试用者锁死在功能里）。关闭时：

- `MULTILINGUAL_ENABLED = false`；`ADDITIONAL_LANGUAGES` 配置**保留**；
  `post.language` 值**保留**；
- `/xx` 视图路由停用；根视图回到「显示一切」（语言过滤整体关闭）；
- **曾配置过的语言前缀**剥前缀 301 回根对应物：
  `/en → /`，`/en/feed → /feed`，`/en/archive → /archive`，`/en/{col} → /{col}`
  （对订阅器尤其重要；内容从「仅英文」变「全部」，正是关闭后站点的真实状态，
  诚实且不断链；符合「可分享 URL 旧形式无限期保留」的项目约定）；
- 重新开启 → 配置原样复活。注意关闭期间新发的帖 `language` 为 NULL（compose
  无语言 UI），所以**重开走与首次开启相同的 §9.2 确认流程**，对话框数字 =
  当前 NULL 帖计数（而非全站帖数），物化 UPDATE 本身幂等（§10.2）。

### 9.5 Setup（首跑向导）

Setup 表单从三项（站名 / 邮箱 / 密码）变四项：**加一个可见的「内容语言」
下拉**，用 `navigator.language` 预填。

理由：内容语言是仅次于站名的博客身份事实；现行的静默推导
（`navigator.language` → `SITE_LANGUAGE`）恰好在「浏览器语言 ≠ 写作语言」
的人群 —— 就是双语作者 —— 身上出错，且 `<html lang>`、RSS、字体全错还
数月无人察觉。预填正确时确认成本约两秒。

- **时区继续静默**取浏览器值（几乎不会错，不值得占表单位）。
- **界面语言不进 setup**：静默初始化规则改为 pin 到
  `resolveCatalogLocale(浏览器语言)`（现行为 pin 到站点语言的 catalog）。
  「中文作者建英文站」场景下：站点 en、后台 zh，各归各位。
- **多语言不进 setup**：高级功能不向 100% 新用户展示（原则 1）；新站零
  存量，事后开启零摩擦，setup 里问它毫无收益。
- CJK 字体预填随该设置的删除一并移除（§12）—— 浏览器语言这个信号从
  「预填字体兜底」升级为「预填内容语言」。

---

## 10. 历史文章处理

原则一句话：**开启前什么都不写；开启时定格；开启后可单篇修正。**

### 10.1 开启前：NULL，且不写入

新旧文章的 `language` 一律保持 NULL，**任何路径都不写入检测值**。理由：

1. 未经作者复核的检测结果不落库（「检测是建议不是权威」）；
2. 提前写入买不到任何东西 —— `body_text` 就在库里，检测器是对存量文本的
   纯函数，开启时再跑信息一模一样；
3. 提前写入制造脏数据（作者中途改过 `SITE_LANGUAGE` 的话，历史行会混着
   不同时期的值，语义不清）。

关闭态下 NULL 没有任何消费者（slug 不需要语言，`<html lang>` 走站点设置）。

### 10.2 开启时：显式确认 + 幂等物化

确认对话框（§9.2）通过后，执行一次幂等回填：

```sql
UPDATE post SET language = :primary
WHERE site_id = :siteId AND language IS NULL;   -- 两个方言都要
```

- **hosted 多站点共库：必须带 `site_id` 界定**（以及未来任何语言相关回填
  同理）—— 漏掉会把别站的存量帖打上本站主语言；
- 这是**设置动作触发的运行时 service 逻辑**，不是 schema migration，也不放
  `src/db/backfills/`（那是部署期历史数据修复的轨道）；
- 打标 root 和回复一视同仁（该站全部 NULL 行）；
- 之后 NULL 绝迹：compose 必带明确值，API/bot 由服务端检测兜底。

**为什么物化而不是让「NULL 视为主语言」成为永久虚拟规则**：

- 过滤 SQL 干净：`language = ?`，而不是每个过滤点永远背着
  `(language = ? OR (language IS NULL AND ? = primary))`；
- 换主语言不改写历史语义：虚拟规则下换主语言会让全部未标注旧文瞬间「变成」
  新语言，几乎必然是错的；物化后每篇的标签定格在开启时刻的事实。

即时效果零惊吓：全部旧文 = 主语言 → 根视图与开启前一模一样，`/en` 从空白开始。

### 10.3 存量纠正：单篇（按 thread）修改，不做批量扫描

存量里混着的英文旧文，纠正通道是**单篇修改**：文章操作菜单 → 语言 → 选择，
按 thread 整条生效。§9.2 的确认对话框已提前把这个预期设置好。

不做「扫描存量 → 检测分桶 → 复核列表 → 批量应用」的 UI（见 §13）。
注意：**检测器本身是 v1 必做的**（compose 预填与服务端兜底都靠它），
不做的只是批量复核界面。

---

## 11. 语言代码、保留字与 slug

### 11.1 语言代码规范

- **存储与机器输出**（`post.language`、settings、`<html lang>`、hreflang、
  Atom `xml:lang`）：BCP 47 **规范大小写**（`zh-Hans`、`en`、`zh-Hant-TW`）。
  入口处（settings 保存、post create/update、检测兜底）统一过现有的
  `normalizeContentLanguage()`（`i18n/locales.ts`，走 `Intl.Locale`，天然
  规范化大小写）；内部比较一律裸 `===`，禁止散落大小写不敏感比较
  （strict boundaries, free internals）。
- **URL 前缀**：规范 tag 的 `toLowerCase()`（`/zh-hans`、`/en`）。映射纯机械、
  单向，不存第二份。路由只认小写；`/zh-Hans/...` 301 到小写形式可选，v1 可不做。
- 语言选择 UI 给常用项（`zh`、`zh-Hans`、`zh-Hant`、`en`、`ja`…）配显示名；
  存的永远是规范化后的 tag。双语作者大概率直接选 `zh` 而非 `zh-Hans`，都合法。

### 11.2 保留字：动态检查，不静态保留

**不把 ISO 639 语言码加进 `RESERVED_PATHS` 静态表** —— 约 180 个两字母码里
全是常用英文单词（it/is/no/go/so/to/id/my/am/be…），为默认关闭的功能永久没收
所有站点的这些 slug 不成比例。改为两个时点各一条规则：

1. **添加语言 `xx` 时**：查 `path_registry` 是否存在 path 等于 `xx`（小写前缀
   形式）或以 `xx/` 开头的行。有 → 阻止添加，报错点名冲突路径：
   「`/ja` 已被文章《…》占用，先修改它的地址再启用日语」。`path_registry`
   本就支持 redirect 行，作者改 slug 自动留 301，解决流程无死链。
2. **语言激活期间**：`isReservedPath()` 判定扩展为「静态列表 + 当前站点已启用
   语言的 URL 前缀」，让新 slug / 自定义 path 无法再占用 `ja` 与 `ja/*`。
   （需要把站点语言配置传入或提供 site-aware 变体，注意它目前是纯函数。）

### 11.3 slug：主路径不感知语言，冲突时非主语言帖先试语言后缀

- **无冲突时**（绝大多数情况）：slug 与今天完全一致，`slugify(title)` 或随机 ID，
  不含任何语言信息。不做「非主语言帖自动加语言前缀」（那会把语言重新编码进
  permalink，且引出"改语言后 slug 是否跟改"的问题）。
- **冲突时**的候选顺序（改 `generatePostSlug`，穿入可选 `language` 参数）：

  ```
  {base}                      ← 现状
  {base}-{lang}               ← 新增：仅当该帖语言为非主语言时尝试一次
                                 （lang = URL 前缀小写形式，如 shu-ping-en）
  {base}-{randomId}  …循环    ← 现状回退
  ```

  理由：冲突回退本来就不可预测（随机后缀），`shu-ping-en` 严格优于
  `shu-ping-x7k2f`。跨语言转写撞车（`書評` 与 `书评` 都转写成 `shu-ping`）
  正是这个候选的目标场景。

- **主语言帖冲突不试语言后缀**，直接走随机：同语言同名帖加语言后缀无区分
  意义，且裸命名空间属于主语言。
- **slug 一经生成永不因改语言而重命名**（与改标题不重命名 slug 同理）——
  旧后缀只是外观残留，无语义。
- 用户手填 slug 的路径不变（冲突直接报错）。

---

## 12. SEO / hreflang / 字体

- **文章页**：有翻译组时，head 输出组内各语言的
  `<link rel="alternate" hreflang="{lang}" href="/{slug}">`；`<html lang>` =
  该帖 `language`。
- **列表面**：各语言视图互出 hreflang alternates（`/archive` ↔ `/en/archive`）；
  `<html lang>` = 视图语言。
- **Sitemap**：文章只列一次（URL 语言中立）；有译本的补 `xhtml:link` alternates。
- 实现落点：`renderPublicPage()`（`lib/render.tsx`）加 alternates 选项 →
  `BaseLayout.tsx` head 输出（现有 canonical / feed alternate 旁边）。
- hreflang 的 `href` 必须是**绝对 URL**，用与现有 canonical 相同的构造链
  （`toPublicHref` + hosted 子路径前缀）；列表面 alternates 可补 `x-default`
  指根视图（v1 可选）。

**字体 profile 纯推导，删除 `CJK_SERIF_FONT` 设置**：

CJK 字体 profile（简/繁/日/韩样式表的选择）不再有用户设置，全部从语言推导：

| 场景                  | profile 来源                            |
| --------------------- | --------------------------------------- |
| 文章页                | 该帖 `language`                         |
| 语言视图（`/xx/...`） | 视图语言                                |
| 多语言关闭            | `SITE_LANGUAGE`（现行第一优先级，不变） |

- `resolveCjkFontProfile()` 简化为纯语言函数（去掉 fallback 参数）；逐帖
  `lang` 属性同时让浏览器原生的 Han 字形选择变准。
- 删除范围：`CONFIG_FIELDS` 的 `CJK_SERIF_FONT`、设置 UI 字段、setup 预填
  （`detectCjkFontFromHeader` 的 setup 用途）、`bootstrap` 写入；库中存量
  settings 行直接忽略。
- 被放弃的场景：多语言关闭 + 站点语言非 CJK + 正文夹 CJK 引文时的字体兜底。
  此类作者的正解是设对站点语言或开启多语言。

---

## 13. 范围外（均为零迁移可后补）

| 项                                              | 说明                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `zxx` 语言无关帖（照片帖出现在所有语言视图）    | future。`zxx` 是合法 BCP 47 值，后补 = compose 一个「所有语言」选项 + 过滤条件一个 `OR`，不动 schema。**若做：只允许作者显式选择，检测器永不自动判定** |
| 批量扫描存量 + 复核 UI                          | future。检测器对存量 `body_text` 是纯函数，将来补「检测分桶 + 复核列表」即可，数据层零迁移                                                             |
| 机器翻译                                        | 不做                                                                                                                                                   |
| 每语言的 collection 标题/描述、导航、站名、页脚 | 不做（骨架规则，Polylang 反面教训）                                                                                                                    |
| 翻译覆盖率提示 / 催促补译                       | 永不做（原则 2）                                                                                                                                       |
| 多值语言（Bluesky `langs` 数组）                | 不做，Jant 无信息流过滤场景                                                                                                                            |
| 全语言合并 feed                                 | 不做                                                                                                                                                   |

---

## 14. 替代方案与不采用的理由

> 实现时不要重新引入下列方案。

| 方案                                                 | 不采用的理由                                                                                                                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文章 URL 带语言前缀（`/ja/{slug}`，Hugo/Astro 模型） | 迫使 `path_registry` 按语言分命名空间，并需要整套「换主语言 → 批量 301 迁移」机制（迁移预览、重定向压平、多条不变量）。Jant 是 microblog，hreflang 足以表达语言；permalink 无前缀让这两个高风险项都不存在 |
| 所有语言都带前缀、`/` 重定向到主语言                 | 现存永久链接全部失效；单语站被迫吃无意义前缀                                                                                                                                                              |
| 关闭态静默写入检测语言                               | 未复核的检测值不该落库；对存量文本开启时重跑检测信息等价；还会混入不同时期站点语言的脏数据                                                                                                                |
| NULL 永久视为主语言（虚拟规则，不物化）              | 每个过滤点永久背合并条件；换主语言会静默改写全部未标注旧文的语言归属                                                                                                                                      |
| 静态保留全部 ISO 语言码为路径保留字                  | 没收 it/is/no/go/id/my 等常用 slug，为默认关闭的功能不成比例                                                                                                                                              |
| 非主语言帖 slug 自动加语言前缀（`ja-{slug}`）        | 语言重新编码进 permalink，且不对称（只有非主语言、只有自动生成的加）；引出改语言后是否重命名的两难                                                                                                        |
| Collection 加 language 字段、每语言一份              | 个人作者不会维护平行策展                                                                                                                                                                                  |
| Collection 完全不做语言过滤                          | 与需求冲突（`/ja/{col}` 需只显示日语成员），也破坏「流按语言」一致性                                                                                                                                      |
| 搜索按语言分索引                                     | trigram 已语言无关，只需过滤器                                                                                                                                                                            |
| 站点骨架统一用英文                                   | 对中文为主的作者是错的；共用一套、主语言书写                                                                                                                                                              |
| 渲染时检测语言                                       | 发布时检测存库；渲染路径必须零检测开销且结果稳定                                                                                                                                                          |
| 「添加译本」时预建服务端草稿 + 预生成 slug           | 标题未定时只能生成随机 slug、随后还要重算；作者反悔会留下空草稿与悬空单元素组。改为 compose 预填 + 提交时原子建组                                                                                         |
| 禁止关闭多语言                                       | 把试用者锁死；permalink 无前缀的设计下关闭本就无损（§9.4）                                                                                                                                                |
| 删除 `/feed/all`                                     | 与本功能无关的 legacy redirect（308 → `/latest/feed`），删除只有死链风险                                                                                                                                  |
| 网站语言留在 General、多语言另开一页（混合态）       | 语言设置出现两个家，认知分裂。要么全在 General，要么全在「语言」页 —— 采用后者                                                                                                                            |
| 多语言内嵌 General 语言区块（不开新页）              | General 本已冗长；多语言开启后区块膨胀无成长空间。集中到「语言」页后 General 减负、语言只有一个入口                                                                                                       |
| 设置页命名「多语言」                                 | 页里承载内容语言、界面语言等单语作者也拥有的设置，叫「多语言」会让单语作者找不到网站语言                                                                                                                  |
| 站点/后台两个字段都叫「语言」，纯靠分组区分          | 设置搜索会出现两条无法区分的同名结果                                                                                                                                                                      |
| 保留 `CJK_SERIF_FONT` 设置                           | 它只是「站点语言信息不足」时的补丁；语言功能补齐信息源后 profile 可全推导，留着只多一个用户难理解的概念                                                                                                   |
| Setup 里加入界面语言 / 多语言选项                    | Setup 保持最小；界面语言 pin 浏览器语言更准且可后改；多语言是少数人群的高级功能，新站零存量、事后开启零摩擦                                                                                               |
| 表级 CHECK 保证「组只挂 root」                       | SQLite 加 CHECK 触发 drizzle 整表重建，静默丢失 `post` 表的 FTS 触发器（搜索停更无报错）；root-only 写入方只有少数 service 方法，service 校验 + partial unique index 已覆盖关键不变量（§3.1）             |
| 按开关条件挂载 `/xx` 路由                            | 挂载表在 `createApp()` 时静态固定，配置是 per-request / per-site 的；hosted 多站点下同一实例服务语言集不同的站点。始终挂载 + handler 判定 + fall-through（§4.4）                                          |
| `ADDITIONAL_LANGUAGE_EN` 式 per-language boolean 键  | `CONFIG_FIELDS` 是静态注册表，BCP 47 开放集合无法逐 tag 预注册；布尔键丢失切换器顺序；逗号分隔单键已覆盖（§3.2）                                                                                          |
| 语言键提供 `envKeys` / 进通用 Config Editor          | env 或裸 `PUT /api/settings` 写入会绕过开启确认与物化（存量 NULL 帖从根视图消失）、绕过前缀冲突检查。DB-only + 仅 service 编排写入（§3.2）                                                                |
| 移除语言时对其帖子做隐藏 / 迁移 / 前缀 301           | 复杂且语义含糊。零帖才许移除：有帖子时阻止并点名数量与出路，不变量简单成立（§9.1）                                                                                                                        |
| 公开页 catalog 随视图语言激活                        | 公开 catalog 现状强制 baseLocale 是为规避 Lingui 消息 ID 碰撞泄漏；随视图切换会重新引入该问题，且属独立范围决定。公开 UI 文案维持英文（§5，D23）                                                          |

---

## 15. 实现地图

> 行号为设计时参考，可能漂移；以符号名为准。

### 15.1 Schema / 类型

- `src/db/schema.ts`（`posts` 表）与 `src/db/pg/schema.ts` 同步加两列 +
  partial unique index（§3.1；**无表级 CHECK**，生成后人工检查迁移 SQL
  确认没有 `post` 表重建）
- `src/lib/ids.ts`：注册 `tgr` 前缀
- `src/types/entities.ts` `Post` 接口（~L47）加 `language` / `translationGroupId`
- `src/types/config.ts` `CONFIG_FIELDS`：新增 `MULTILINGUAL_ENABLED`、
  `ADDITIONAL_LANGUAGES`（两键均**省略 `envKeys` 与 `editor`**，§3.2）；
  **删除 `CJK_SERIF_FONT`**（连同 `appConfig.cjkSerifFont`；删除范围全局
  grep `CJK_SERIF_FONT` / `cjkSerifFont` / `detectCjkFontFromHeader`，触点
  不止 §15.4 列出的——还有 `lib/resolve-config.ts`、`client/settings-bridge.ts`、
  `client/components/settings-types.ts`、`jant-settings-general.ts`、
  `i18n/detect.ts` 等）
- `src/lib/schemas.ts`：`PostFieldsSchema`（~L208）加 language；settings 校验
  （语言 tag 过 `normalizeContentLanguage`）

### 15.2 Service 层

- `src/services/post.ts`：
  - `PostFilters`（~L125）加 `lang`；`buildFilterConditions`（~L873）与
    thread-root 变体（~L1268）各 push 一个条件；`ThreadRootPageOptions`（~L174）同步
  - `toPost`（~L1141）、insert 点（~L2024 create / ~L2101 thread tx）带新列
  - 新方法：thread 整条改语言；翻译组的建组/入组/退组/按组查询（校验目标为
    thread root 且同站，§3.1）；创建时处理 `translationOfId`（源帖建组 +
    新帖入组，事务内）
  - 开启时物化回填（幂等 UPDATE，**带 `site_id` 界定**，§10.2）
- `src/lib/slug.ts` `generatePostSlug`：可选 `language` 参数 + 冲突候选顺序（§11.3）
- `src/services/settings.ts`：多语言开关 + 语言列表的读写与校验；开启动作的
  编排（校验前缀冲突 → 写 settings → 物化回填）放 service（多步编排不进路由）；
  移除语言的零帖校验（§9.1）与换主语言的列表互换（§9.3）也在此。这些编排
  方法是两个 DB-only 键的**唯一**写入口
- 其余 post 创建方（服务端检测兜底都要覆盖）：`routes/api/telegram.ts`、
  `services/mcp.ts`、`routes/compose.tsx`、`services/about-page.ts` 等

### 15.3 路由 / 视图语言

- `src/app.tsx`（挂载表 ~L355–583）：语言前缀路由组**始终挂载**于
  `pageRoutes` catch-all 之前；handler 内 per-request 判定 —— 已启用 →
  注入 `viewLang`；曾配置（已关闭）→ 剥前缀 301；其余 → `next()`
  fall-through 到 catch-all（§4.3、§4.4、§9.4）
- `src/routes/pages/page.tsx` catch-all：`/xx/{slug}` 对称解析（§4.2）
- `src/lib/timeline.ts` `assembleTimeline`（~L335）及相关 assemble 函数传入视图语言
- `src/routes/pages/archive.tsx`、`search.tsx`、`collections.tsx`、
  `collection.tsx`、`latest.tsx`、`featured.tsx`、`home.tsx`：接 `viewLang` 过滤
- `src/routes/feed/feed.ts`：feed 按视图语言；`src/routes/feed/sitemap.ts`：alternates
- `src/routes/api/public/*`：`lang` 过滤参数
- `src/i18n/middleware.ts`：`c.set("lang", ...)` 逻辑接入视图语言/帖子语言
  （仅 `<html lang>` / RSS 的 `lang` 值；**catalog 维持 baseLocale 不动**，D23）
- worker 响应缓存无需改动：`isRssFeedPath` 以 `endsWith("/feed")` 匹配，
  `/en/feed` 自动进缓存；feed TTL 60s（`RSS_FEED_CACHE_CONTROL`），开关
  切换后的陈旧窗口可忽略

### 15.4 UI / 客户端

- compose：`ComposeDialog.tsx`（labels）+ `client/components/jant-compose-dialog.ts`
  （选择器渲染，root 行 only；参考 `_renderPostMetaControl` ~L5148 的 per-row 控件
  模式）+ `compose-types.ts`（`ComposeSubmitDetail` ~L306、`LocalDraft` ~L79，
  两者都加 `language` 与 `translationOfId`）
- 检测器：新建同构 lib（如 `src/lib/lang-detect.ts`），客户端仅 compose 加载
- 文章操作菜单：改语言（按 thread）、添加译本、关联/解除译本
- 新「设置 → 语言」页（新增 dash 路由 + content 组件 + client 组件，§9.1）：
  内容语言/主语言、界面语言、多语言开关与其他语言管理、开启确认对话框
  （§9.2）、改主语言确认（§9.3）；`GeneralContent.tsx` 移除语言字段，
  「Language & Time」区块只剩 Time Zone
- `routes/auth/setup.tsx`：内容语言下拉（`navigator.language` 预填）、
  移除 CJK 预填；`services/bootstrap.ts`：`DASHBOARD_LANGUAGE` pin 改为
  浏览器语言的 catalog locale、移除 `CJK_SERIF_FONT` 写入（§9.5）
- `ui/font-themes.ts` `resolveCjkFontProfile` 简化为纯语言推导；
  `BaseLayout.tsx` 按帖/视图语言取 profile（§12）
- 公开页：语言切换器（导航）、文章页译本链接行、collection 空态文案
- `BaseLayout.tsx` / `lib/render.tsx`：hreflang alternates、`<html lang>`
- 所有新增文案走 Lingui `msg` + `@context:`，插值进 `values`（勿拼进 message）

### 15.5 保留字

- `src/lib/constants.ts` `isReservedPath`：扩展为可感知站点已启用语言前缀（§11.2）
- 添加语言时的 `path_registry` 冲突检查（settings service 内）

---

## 16. 建议实现顺序与验证

分四个可独立验证的阶段（每阶段行为变更跑 `mise run check-tests` + `check-lint`）：

1. **数据与过滤地基**：两列 + 双方言迁移 + `PostFilters.lang` + 物化回填方法 +
   slug 冲突候选。测试：partial UNIQUE 约束、service 层 root-only 与同站校验
   （§3.1，替代表级 CHECK）、过滤条件、回填幂等性与 **site 界定**、
   slug 候选顺序（主语言 vs 非主语言）。
2. **设置与生命周期**：「设置 → 语言」页、setup 内容语言项与 pin 规则、
   `CJK_SERIF_FONT` 删除与字体推导、开启确认与打标、前缀冲突检查、
   关闭/重开、改主语言确认。测试：开启→关闭→重开往返无损（重开确认数字 =
   NULL 计数）；冲突阻止；移除语言零帖阻止（§9.1）；换主语言列表互换
   （§9.3）；DB-only 键经 `PUT /api/settings` 被拒；`isReservedPath` 动态
   扩展；字体 profile 推导（帖/视图/关闭态三来源）。
3. **视图语言路由**：`/xx` 挂载、catch-all 对称解析、剥前缀 301、feed/sitemap/
   hreflang、切换器。测试：`/en/{slug}` 301、`/en/{col}` 过滤渲染、collection
   目录不隐藏空集合、主语言前缀 301、关闭后 301、未启用前缀 fall-through 到
   slug 解析（slug 恰为语言码的站点）、feed `xml:lang`。
4. **Compose 与翻译组**：检测器 + 预填、提交链路（含 `translationOfId`）、
   译本添加/关联/解除、文章页译本链接、单篇（按 thread）改语言。测试：
   检测器字符集用例（含简繁投票）、组约束冲突文案、回复继承、
   「添加译本后放弃」零服务端痕迹。

验收基线（手动走查）：

- 单语作者：开关关闭时全站与实现前逐像素无差异，compose 无任何新 UI；
- 双语作者：开启（含确认打标）→ 发一篇英文帖 → `/en` 出现且 `/` 不出现 →
  给旧中文帖「添加译本」（中途关闭一次验证零痕迹，再完整发布）→ 两篇互见 +
  hreflang → 切换器在有/无译本文章上行为符合 §5 表格 → `/en/collections`
  列出全部集合且空集合详情页有出路文案 → 关闭后 `/en/feed` 301 到 `/feed`。
