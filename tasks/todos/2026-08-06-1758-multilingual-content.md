# 多语言内容功能 — 实现设计文档

状态：**已完成 —— 四个阶段全部实现并验证**（见文末「实现记录」）
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
- **两条「宁可不答」的规则**（`MIN_SIGNAL` / `CJK_WEIGHT`）：
  - **片段不算证据**：信号量满 10 分才回答，CJK 字符按 3 分、拉丁字母按 1 分
    ——四个汉字或两个英文单词。不够就回落调用方默认值（compose 里就是页面
    语言）。少了这条，pill 会在第一个字母上就翻语言，读起来是抽搐不是判断。
  - **按「主要是什么」判，不按「出现过什么」判**：CJK 与拉丁比信号量，大的
    赢。少了这条，一篇英文里引一句中文就会被读成中文。
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
- 位置（已定）：**Post 按钮左边的一颗 pill**，只在 root 行渲染。图标就是站点
  右上角切换器那颗 globe，同一份 artwork——语言在这个站点已经有符号了。
- pill **只在有话说的时候才写出语言名**：
  - 自动态、且结果就是当前页面的语言 → 只有 globe（答案就是你站的那一页）；
  - 检测把语言挪走了，或作者自己选过 → 长出语言名（显式选过转主色）。
    这样「检测改了你的语言」靠自己出现来宣布，不需要额外标记；无障碍名
    (`aria-label` / `title`) 任何时候都完整报出语言。
- 点开是 popover：「自动 · 读你写的字 — 看起来像 X」+ 每个语言一行。选项 =
  主语言 + `ADDITIONAL_LANGUAGES`，显示名用语言自己的名字（简体中文 /
  English / 日本語）。语言不进 Options 面板，一个设置只有一个入口。
- **不做发布前的确认弹窗。** 曾经做过一版：检测读出的语言与页面语言不一致时，
  发布前弹 sheet 问「发成哪个」。删掉了，因为 pill 写出语言名的条件与它的触发
  条件完全重合——每一次弹窗会出现的场合，Post 左边早就从一颗地球变成了
  「English」。弹窗问的问题 pill 已经答了，它提供的选项 pill 点开就是。
  - 连带不做的还有「不再提示」偏好：那个选项说不清自己的后果。sheet 有两个
    并列答案（信检测 / 用页面语言），一个勾选无法表达「以后按哪个」；要说清
    只能把勾选绑到按钮上，偏好就从两态变三态。这套复杂度是弹窗带来的，不是
    功能本身要求的。
  - 兜底：检测第一次把语言挪走时，pill 上那个词有一次很轻的淡入（0.22s，
    `prefers-reduced-motion` 下取消）。它把「它替你改了」说出来，但不要求
    回答，也就没有「下次默认是什么」这个问题。
  - 真发错了不是不可逆：文章菜单有「更改语言」（整条 thread），编辑时 pill
    也在。

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

---

## 17. 实现记录

实现前做了一次代码库对照评审，验证了 D20（FTS 触发器确实存在，加 CHECK 会整表重建）、
D21（`resolve()` 用 `envKeys ?? []`、`editableSettingKeys` 过滤 `"editor" in field`）、
`isRssFeedPath("/en/feed")` 为 true、`BaseLayout` 读 `lang ?? c.get("lang")`。
以下是与设计文档不同或文档未覆盖的地方，**以本节为准**。

### 17.1 对设计的修正

**M1 — §4.4 挂载方案的唯一可行写法（Hono 实测）**
Hono 的中间件无法跳过后续已匹配的 handler：`app.use("/:lang", gate)` 里 `next()`
会直接进入语言 handler。实测（hono 4.11.9）确认唯一正确的构造是：

- 语言路由组挂在**所有静态路由组之后、`pageRoutes` catch-all 之前**；
- gate 必须写在**每个终端语言 handler 内部**，非启用前缀时 `return next()`。

实测通过的路径矩阵：`/archive`→根、`/en/archive`→语言视图、`/en/{slug}`→语言
catch-all、`/fr`、`/hello`、`/hello/text/{id}`→`pageRoutes` catch-all、
`/settings/*`→设置路由。实现时用 `langGet()` helper 把 gate 焊进注册，避免漏写。

**M2 — 语言视图需要链接生成跟着变，不只是过滤**
`/xx/*` 不是「只读包装」：`home.tsx` 的分页 `baseUrl`、WebSite JSON-LD 的
`searchUrlTemplate`、archive/search/collection 的分页与筛选 URL、
`renderCollectionFeed` 的 `/{col}/feed` 全部硬编码根路径。语言视图下必须带前缀，
否则 `/en` 第二页会跳回主语言时间线。→ 阶段 3 需把这些 handler 抽成按
「视图 base path」参数化的共享函数，不能只往 context 塞 `viewLang`。

**M3 — `post.language` 定为 thread 内统一的不变量（替代按粒度分别写过滤条件）**
`buildThreadRootPageConditions` 被 collection 查询复用，那里行是按 `thread_id`
分组的 thread **成员**（所以 `rootFormat` 写成 `EXISTS ... root.id = posts.thread_id`）。
若直接 `posts.language = ?` 会过滤错行。采用的解法是把语言定为 thread 级不变量：

- 回复创建时**强制继承 root 的语言**，忽略调用方传入值；
- 改语言走 `setThreadLanguage`，**整条 thread 一起改**；
- 开启回填覆盖该站全部 NULL 行（root 与回复一视同仁）。

这样列谓词在 root 粒度和成员粒度都正确，且比 EXISTS 子查询快。已有测试锁住。

**M4 — CJK 字体变量的计算位置**
`themeStyle`（含 `getCjkFontCssVariables`）是在 `withConfig()` 里按
`appConfig.siteLanguage` **每请求算一次**的，§12 要按帖/视图语言推导就必须挪到
layout。已确认无内置字体主题定义 `--font-cjk-*`，所以 `withConfig` 里
`{...cjk, ...fontTheme}` 的合并顺序是空约束，挪动安全。
`services/site-admin.ts` 的静态导出走同一套，需同步处理。→ 阶段 2。

**M5 — 站点导出/导入（设计文档完全未覆盖）**
`jant.toml` + 文章 frontmatter 是真实的往返通道（有
`export-import-roundtrip.test.ts`）。不处理的话导出再导入会整站丢多语言。
已做：frontmatter 增加 `language` / `translation_group`（仅 root bundle），
`HugoFrontMatter` 类型同步，导入端映射 `language`。
待做：`translation_group` 的重建需要 link 端点（→ 阶段 4）；
`MULTILINGUAL_ENABLED` / `ADDITIONAL_LANGUAGES` 进 `jant.toml`（→ 阶段 2）。

**M6 — 移除语言的零帖校验必须无视开关状态**
关闭多语言后语言设置页仍可进入，`countByLanguage` 不能只在开启态生效。→ 阶段 2。

### 17.2 阶段 1 已完成（数据与过滤地基）

- `post` 表加 `language` / `translation_group_id` + partial unique index，
  **两个方言同步**。迁移 `0032_married_tomas.sql`（SQLite）与
  `0030_abandoned_nighthawk.sql`（PG）经人工核对**只有 `ADD COLUMN` 与
  `CREATE INDEX`，无表重建**，FTS 触发器安全。
- `ID_PREFIX.translationGroup = "tgr"`；`Post` 实体加两个字段；
  `toPost` 与 search 的 `RawSearchRow`/`mapRow` 同步（搜索 SQL 用 `post.*`，
  列自动带出）。
- `PostFilters.lang` + `ThreadRootPageOptions.lang`，两个条件构造器各加一条。
- `CreatePost.language` / `CreatePost.translationOfId`；`PostFieldsSchema` 加
  `language` / `translationOfId`，新增导出的 `ContentLanguageSchema`；
  `/api/posts` 与 compose 路由转发（thread 批量创建时只有 root 携带）。
- 新 service 方法：`setThreadLanguage`、`materializeMissingLanguage`、
  `countMissingLanguage`、`countByLanguage`、`listTranslations`、
  `getTranslationsMap`、`linkTranslation`、`unlinkTranslation`。
  root-only 与同站校验集中在 `requireTranslatableRoot`，组内语言唯一性
  在 `assertTranslationLanguageFree`（DB 的 partial unique index 是最后一道）。
- 「添加译本」提交时原子建组：源帖无组则在同一 batch/transaction 内补写组 ID，
  失败不留单元素组（有测试）。
- `generatePostSlug` 加 `languageSuffix`；非主语言帖冲突时先试 `{base}-{lang}`。
  主语言判定读 `SITE_LANGUAGE`，**仅在「有标题 + 有语言」时才查**，
  单语站零额外查询。
- `materializeMissingLanguage` 先 count 再 update 返回条数：三种驱动报告
  affected rows 的方式不一致，调用方只需要数字做文案。

**验证**：`mise run check-tests` 252 files / 3201 tests 全绿（新增 59 个用例：
`services/__tests__/post-language.test.ts` 40 个、`lib/__tests__/slug.test.ts`
+7、其余为既有用例）；`check-lint`、`check-types`、`check-format` 全绿。
覆盖：thread 统一不变量（回复继承 / 整条改 / 任意帖为入口）、
lang 过滤（含成员粒度的 collection 与 featured 查询）、回填幂等性与
**site 界定**（另建一站验证不被误标）、翻译组建组/入组/退组/单元素折叠/
组内语言冲突/跨站源帖拒绝/失败零残留、DB 层 UNIQUE 兜底、
slug 候选顺序（主语言 vs 非主语言 vs 语言 slug 也被占）。

### 17.3 阶段 2 已完成（设置与生命周期）

**新 service：`src/services/language.ts`**（不是把编排塞进 settings service —
后者够不到 posts/paths）。`LanguageService` 是两个 DB-only 键的**唯一写入口**：
`getState` / `getEnablePreview` / `enable` / `disable` / `setPrimary` /
`addLanguage` / `removeLanguage`。同文件另导出 `readLanguageSettings(db, siteId,
schema)` —— 一个独立的**读**函数，给 post 与 custom-url service 在 slug/路径
校验时用，避免为两个值把整个 service 穿进去。

- `CONFIG_FIELDS` 加 `MULTILINGUAL_ENABLED` / `ADDITIONAL_LANGUAGES`：**均无
  `envKeys`、无 `editor`**，只带 `configEditorLink`（可搜索、不可写、不可 reset）。
  已有测试断言 `PUT /api/settings` 拒绝这两个键。
- `AppConfig` 加 `multilingualEnabled` / `additionalLanguages`。
- `i18n/locales.ts` 加 `toLanguagePrefix` / `parseLanguageList` /
  `formatLanguageList`（逗号分隔值的容错解析：丢空值与非法 tag、规范化大小写、
  去重、保序）。
- `isReservedPath(path, languagePrefixes?)` 扩展为可感知站点已启用前缀；
  穿到 `generatePostSlug`（新 `reservedPrefixes` 选项）、post service 的
  `data.path` 校验、custom-url service 的 `create` 与 `isPathAvailable`。
  双向防护：加语言时查 `path_registry`（新 `PathService.findPathsUnderSegment`，
  用带 `ESCAPE` 的 LIKE 以兼容两个方言），启用期间禁止新 slug/自定义 URL 占用前缀。

**设置 IA**：新建 `/settings/language` 页（route + `LanguageContent.tsx` +
`jant-settings-language.ts`）。该 Lit 组件**不走 settings bridge**：它的操作不是
「保存表单」而是各自带确认与失败语义的命令，所以直接对自己的端点发请求。
端点：`POST /settings/language`（内容语言 / 界面语言，字段级可选）、
`/enable`、`/disable`、`/primary`、`/add`、`/remove`。
General 页只剩 Time Zone（区块改名 `Time`，端点 `/general/language-time` →
`/general/time`）。

**D17 `CJK_SERIF_FONT` 删除**（用户确认执行）：删了 `CONFIG_FIELDS` 字段、
`AppConfig.cjkSerifFont`、`resolve-config`、`schemas.ts` 校验、settings service
的读写与 `LocaleSettingsData`/`GeneralSettingsData`、`GeneralContent`、
`jant-settings-general`、`settings-bridge`、`settings-types`、
`ConfigEditorContent`、setup 预填、`bootstrap`、`site-admin`，以及
`i18n/detect.ts` 的 `detectCjkFontFromHeader` / `isCjkSerifFont` /
`CJK_SERIF_FONT_VALUES`（类型收敛为 `CjkFontProfile`，去掉了没有意义的 `"off"`
成员）。

**字体按语言推导（M4）**：`resolveCjkFontProfile(language)` 变成纯语言函数；
`getCjkFontCssVariables` 从 `withConfig()` **移到 `BaseLayout`**，按
`resolvedLang`（帖子语言 / 视图语言 / 站点语言）产出，并在 `themeStyle` **之前**
输出 `:root:root` 块，让字体主题仍然优先。`site-admin` 的静态导出保持站点级
（Hugo 扁平导出没有 per-page 语言的对应物，已注释说明）。

**Setup（§9.5）**：新增可见的「内容语言」下拉，用 **`Accept-Language` 服务端
预填**（新 `resolveSupportedLocaleTag`：精确 tag → 语言+脚本（`maximize()`，
让 zh-CN→zh-Hans）→ 裸语言 → en），比客户端 JS 猜更稳。
`DASHBOARD_LANGUAGE` 改为 pin 到**浏览器**语言的 catalog（`browserLanguage`
与 `siteLanguage` 在 bootstrap 里彻底分开），CJK 预填随设置一并删除。

**导出（M5 部分）**：`jant.toml` 增加 `multilingual_enabled` /
`additional_languages`。**导入端有意未接**：raw 写这两个键会绕过启用确认与
前缀冲突检查，且写入顺序早于建帖时会让未标记的帖子从根视图消失 —— 正是 D21
要防的。导入后由作者在语言页一键重开即可，帖子的 `language` 已在阶段 1 往返。

**i18n**：37 条新设置文案已补 zh-Hans / zh-Hant 翻译，覆盖率回到 100%。

**验证**：`check-tests` **255 files / 3252 tests 全绿**（阶段 2 净增 51 例）；
`check-lint`、`check-types`、`check-format`、`i18n-check` 全绿。
新测试：`services/__tests__/language.test.ts`（28 例：state、enable 与打标、
前缀冲突四向（帖子 slug / 嵌套路径 / 应用保留字 / 部分冲突时零写入）、
反向防护（自定义 URL 与新 slug 不得占用启用中的前缀）、换主语言的列表互换与
不动帖子、移除语言的零帖校验（含草稿、含关闭态）、开→关→重开往返只标记关闭
期间的帖子、语言集合不变量）；
`client/components/__tests__/jant-settings-language.test.ts`（24 例：单语态不
露多语言痕迹、选择器筛选/空态/Escape/外点关闭、启用对话框的数量文案（复数/
单数/空站）与随主语言联动、无第二语言不可确认、Escape 取消不写入、URL 预览
（含 hosted 子路径前缀）、添加/移除（失败时不改 UI）、换主语言的确认文案与
列表互换、关闭确认、界面语言只提交自己那个字段）；
`i18n/__tests__/supported-locales.test.ts`（14 例）；
另有 `api-settings`、`/api/settings` 路由、`BaseLayout`、`font-themes`、
`settings`、`setup`、`detect` 的更新用例。

### 17.4 阶段 2 的 UI 修复（浏览器实测后）

浏览器实测发现 6 个缺陷，均已修复并补测试：

1. **页面顶部大片空白** —— `createRenderRoot()` 直接 `return this`，没有清 SSR
   骨架。lit-html 是**追加**自己的 part 而不是替换已有子节点，所以那个
   `skel-section-lg` 占位块一直堆在真实表单上方。库内其他 light-DOM 组件
   （`jant-settings-general` / `jant-settings-avatar` / `jant-confirm-dialog`）
   都先 `this.innerHTML = ""`，照做即可。
2. **「+ 添加语言」按钮没有可见文字** —— 用了 `btn-outline btn-sm`，正是
   AGENTS.md「Common Pitfalls」点名的 BaseCoat 变体组合错误。正确类名是
   **`btn-sm-outline`**（BaseCoat 的尺寸+变体是合成的单一类）。
3. **开启对话框内容竖排成一列、文字重叠** —— `.alert` 是两列 grid，只有
   `> h2..h6 / strong / [data-title]` 和 `> section` 会落到 `col-start-2`；
   裸 `<p>` 落进宽度为 `0` 的第一列。改为 `svg + <strong> + <section>` 结构。
4. **数量显示为 `NaN`** —— 根因是**把 ICU 模板当字符串发给客户端**：Lingui 在
   `i18n._()` 时就会把消息完全格式化，`{count, plural, ...}` 对着 `undefined`
   算出 NaN。解法是新增 `keepPlaceholder(name)` —— 把占位符文本本身作为 value
   传给 Lingui，于是**服务端用真实 count 解析复数**，只把真正在浏览器才知道的
   槽（`{language}` / `{next}` / `{previous}` / `{prefix}`）原样留给组件。
   客户端 `interpolate` 随之简化为纯 `{name}` 替换，删掉了自制的复数分支。
5. **开关在确认前就视觉翻转，取消后与真实状态不一致** —— 浏览器点击即翻转
   checkbox，而 Lit 不会回滚（绑定值没变，没有可重新提交的东西）。新增
   `#syncMultilingualCheckbox()`，在取消 / 失败 / 对话框关闭三条路径上把 DOM
   写回真实状态。
6. **Toast 显示裸 tag `zh-Hant`** —— 改用 `getOrBuildEntry(tag).native`。

**文案重写**：多语言开关说明与开启/关闭对话框改为具体陈述影响（每种语言独立的
首页/归档/订阅源/集合页、发布时选语言并可互相关联为译本、文章地址不变、可安全
关闭）。开启对话框改为「开启后会发生什么」四条列表 + 独立的一次性打标警示。
中文译文在插值语言名两侧加「」，避免中英夹排贴在一起。

新增测试：`ui/dash/settings/__tests__/LanguageContent.test.tsx`（6 例，锁住
「服务端解析复数、保留运行时槽、任何 label 都不得泄漏 `plural,` 或 `NaN`」），
组件测试补 3 例覆盖开关同步。

### 17.5 阶段 3 执行方案（视图语言路由）

> 下面的 Hono 行为是**实测结论**（hono 4.11.9），不要凭直觉重推。

**S1. 挂载机制（M1，已实测）**

- `app.route("/:lang", langRoutes)` 可用，`c.req.param("lang")` 正常解析。
- Hono 中间件**无法跳过**后续已匹配的 handler：`app.use("/:lang", gate)` 里
  `next()` 会直接进入语言 handler。因此 gate 必须写在**每个终端语言 handler
  内部**，非启用前缀时 `return next()`。
- 挂载点必须在**所有静态路由组之后、`app.route("/", pageRoutes)` 之前**
  （`app.tsx` 尾部，`pageRoutes` 那一行的上一行）。
- 实测通过的路径矩阵（务必写成回归测试）：
  `/` `/archive` `/archive/feed` `/feed` `/collections` `/collections/{slug}`
  → 根路由；`/en` `/en/archive` `/en/feed` `/en/collections` `/en/{slug}`
  `/en/a/b` `/zh-hant` `/zh-hant/archive` → 语言视图；
  `/fr` `/hello` `/hello/text/{id}` → `pageRoutes` catch-all；
  `/settings` `/settings/general` → 设置路由。
- 实现形态：新建 `src/routes/pages/language.tsx`，内部用
  `const langGet = (path, handler) => langRoutes.get(path, async (c, next) => {
const view = resolveLanguageView(c); if (!view) return next(); ... })`
  把 gate 焊进注册，避免漏写。`langGet("/*")` 必须**最后**注册。

**S2. gate 的三分支（§4.4 / §9.4）**

首段命中 `appConfig.additionalLanguages` 且 `multilingualEnabled` → 注入
`viewLang` 走视图；命中 `additionalLanguages` 但**已关闭** → 剥前缀 301；
首段等于主语言前缀 → 301 回根对应物（§4.3）；其余 → `next()`。

**S3. handler 抽取（M2 —— 本阶段最大的一块）**

`/xx/*` **不是**只读包装：现有 handler 硬编码了根路径。已确认的触点：
`home.tsx` 的分页 `baseUrl = toPublicPath("/")` 与 WebSite JSON-LD 的
`searchUrlTemplate`；`archive.tsx` / `search.tsx` / `collection.tsx` 的分页与
筛选 URL；`renderCollectionFeed` 的 `/{col}/feed`。不改则 `/en` 第二页会甩回
主语言时间线。

做法：把 `home / archive / latest / featured / search / collections /
collection` 的 handler 各抽成导出的 `renderXxx(c)`，内部用一个新的
`viewBasePath(c)`（无 viewLang → `""`，有 → `/en`）拼所有站内链接；根路由与
语言路由注册**同一个函数**。`feed/feed.ts` 同理。

**S4. 其余**

- `viewLang` 加进 `AppVariables`；在 gate 里 `c.set("lang", viewLang)`
  覆盖 i18n middleware 写的站点语言（文章页则设为该帖 `language`）。
  **catalog 维持 baseLocale 不动**（D23）——`viewLang` 只驱动 `<html lang>`、
  feed 语言标记、字体 profile（阶段 2 已改成读 `resolvedLang`）与内容过滤。
- `page.tsx` catch-all：`/xx/{slug}` 对称解析（文章 → 301 到 `/{slug}`；
  collection → 该语言过滤视图；redirect 行照跟；未命中 404）。
- `feed.ts` 按视图语言过滤 + Atom `xml:lang` / RSS `<language>`；
  `sitemap.ts` 给有翻译组的文章补 `xhtml:link` alternates。
  `isRssFeedPath("/en/feed")` 已确认为 true，worker 缓存无需改动。
- `renderPublicPage()` / `BaseLayout` 加 hreflang alternates。
- 导航加语言切换器（语义见 §5 表格：有译本 → 那篇；无译本 → `/xx` 首页；
  列表面 → 同表面的 `/xx` 版）。
- `/api/public/*` 加 `lang` 过滤参数。
- Collection 目录**不按语言隐藏**；详情页空态要给出路文案。
- 新增公开文案以**英文源文案**交付（D23），不进 zh catalog。

### 17.6 阶段 3 已完成（视图语言路由）

**新增**

- `lib/view-language.ts` —— 本阶段的地基。`resolveLanguageView`（三分支
  gate）、`getViewLang`（内容过滤语言）、`isPrefixedLanguageView`（是否带前缀）、
  `viewBasePath` / `toViewPath` / `viewRelativePath` / `toLanguagePath`、
  `getViewLanguages`、`buildSurfaceAlternates`、`buildLanguageSwitcher`。
- `routes/pages/language.tsx` —— `langGet()` 把 gate 焊进注册，按 §17.5 挂在
  `app.tsx` 的 `homeRoutes` 之后、`pageRoutes` 之前。
- `AppVariables.viewLang`（可选）。

**两个语言概念必须分开（实现中踩到的坑）**

`viewLang`（URL 前缀，决定链接前缀与 `/xx/{slug}` 的 301）和 **内容过滤语言**
（`getViewLang`）不是一回事：多语言开启时**根就是主语言的视图**，所以根上
`getViewLang` 返回主语言而 `viewBasePath` 返回空串。合成一个会让 `/` 显示全部
语言而 `/en` 只显示一种。

**过滤从 context 读，不逐层传参**

`assembleTimeline` / `assembleFeaturedTimeline` / `assembleCollectionTimeline` /
`buildFeedData` / `buildArchivePostFilters` / 搜索路由都直接 `getViewLang(c)`，
调用方无法漏传。`search` service 新增 `lang`（4 处 SQL，索引本身语言无关）。

**链接作用域：新增 `basePath` 概念**

`NavigationData.basePath = sitePathPrefix + viewBasePath`。页面组件里凡是**只**
用于本表面自身链接的 `sitePathPrefix` 直接改名 `basePath`（`ArchivePage`、
`SearchPage`）；混用管理链接的组件（`CollectionPage`、`CollectionsPage` /
`CollectionDirectory`）**两个 prop 并存**，默认 `basePath = sitePathPrefix`。
`toNavItemView` 新增 `basePath`，只作用于语言化系统项（latest/featured/
collections/archive/rss）与 collection 项 —— settings/signin 与文章链接不加前缀。

**path_registry catch-all 复用同一个 handler**

`pageRoutes.get("/*")` 抽成 `renderRegisteredPath(c)`，内部用
`viewRelativePath(c)` 解析，所以 `/en/hello` 与 `/hello` 命中同一行；命中文章时
若在语言视图下就 301 到规范地址（别名优先），文本附件深链同理。

**SEO / a11y**

- `RenderPublicPageOptions.alternateLanguages` → `BaseLayout` 输出
  `<link rel="alternate" hreflang>`。列表面用 `buildSurfaceAlternates(c)`；
  文章页用翻译组（`listTranslations`），并把 `<html lang>` 设为该帖 `language`
  （字体 profile 随之正确）。
- **不发 `x-default`**：hono/jsx 会把 `href` 相同的 `<link>` 去重，而 x-default
  必然与主语言同 URL，发了反而把主语言那条挤掉。实测确认，spec 里本就可选。
- Atom `<feed>` 现在输出 `xml:lang`（此前 `FeedData.siteLanguage` 根本没被渲染）。
- Sitemap：`SitemapUrlEntry.alternates` → `<xhtml:link>`，命名空间按需声明；
  `listForSitemap` 补 `language` / `translationGroupId`，路由用
  `getTranslationsMap` 批量取组。

**语言切换器**

复用 More 菜单的 class 与交互（`site-header-nav.js` 的 `initMoreDropdown` 泛化成
`initDropdown(root, trigger, popover)` + `DROPDOWNS` 表，共享
`basecoat:popover` 互斥）。`renderPublicPage` 默认注入
`buildLanguageSwitcher(c)`，文章页覆盖为翻译组语义。窄屏隐藏 header 版，抽屉里
有独立 Language 段。

**CSS 顺序陷阱（浏览器实测才发现）**：`.site-header-lang-popover` 与
`.site-header-more-popover` 特异性相同，`left/right` 靠源码顺序决胜 —— 覆盖块
必须放在 `.site-header-more-*` **之后**，否则弹层左对齐并溢出视口右边。

**其他**

- `/api/public/posts`、`/api/public/archive` 加 `lang` 参数（`ContentLanguageSchema`
  校验，非法 tag → 400）；响应体新增 `language` / `translationGroupId`。
- Collection 详情页空态：本语言为空但其他语言有内容时给出路
  （"Nothing in English here yet. Read it in 简体中文"），只在为空时多跑一次计数。
- 新增公开文案全部英文源文案（D23），未进 zh catalog。

**验证**：`check-tests` 258 files / 3333 tests 全绿，`check-lint`、`check-types`、
`check-format` 均通过；i18n 重新生成，coverage 100%（`i18n-check` 在 `.po` 未提交
时必然报 out of sync，与阶段 2 相同）。浏览器实测：路径矩阵、切换器弹层与跳转、
`/en/{slug}` 301、文章页 `<html lang>`、hreflang、`xml:lang`、抽屉语言段。
**未做视觉验证**：窄屏抽屉（浏览器 resize 在本环境不生效），改用 markup 断言覆盖。

### 17.7 阶段 4 已完成（Compose 与翻译组）

**检测器 `lib/lang-detect.ts`（同构，约 4KB）**

`detectScript`（纯脚本判定）与 `detectContentLanguage`（约束到站点语言集）分开，
两者各自可测。Hangul/假名近乎必中；简繁靠 530/536 个单侧汉字投票，**平票即拒绝**
而不是瞎猜。拉丁字母只说明「非 CJK」，仅当站点只有一种非 CJK 语言时才据此定语言。

字符表构造时排除了 `后 台 只 划 冲 叠` 这类**繁体中也在用**的简化字（它们会投错
票），但保留其繁体对应字 `後 臺 隻 劃 衝 疊` —— 两个集合是独立计数器，不必成对。

**兜底落在 service，不是逐个调用方**

`posts.create` 里 `!data.replyToId && !language` 时跑 `suggestPostLanguage`，所以
API、Telegram、MCP、compose 全部自动覆盖，调用方无法漏。显式选择永远不被推翻；
单语站点（`readLanguageSettings().languages` 为空）永远不打标（§10.1）。
`readLanguageSettings` 因此多返回一个 `languages`（单语站点为空数组）。

**新端点**

`PUT /api/posts/:id/language`、`GET|POST|DELETE /api/posts/:id/translations`。
`setThreadLanguage` 现在还校验「该语言必须在站点语言集内」—— 只在站点已有语言集时
生效，否则阶段 1 的 40 个测试（无 settings）会全挂。

**Compose**

语言选择器放在 **publish panel**（root-only，复用 `compose-sheet-row` 单选行，零
新 CSS），而不是 per-row 的 post-meta 药丸 —— 语言是整条 thread 的属性。
默认「Detect」= 不发 `language` 字段，由服务端对最终正文判定；面板打开时即时读一次
编辑器正文给出建议（不监听每次按键：面板是作者主动打开的）。
`ComposeSubmitDetail` / `LocalDraft` 加 `language` + `translationOfId`。

**文章菜单**

`Language`（改整条 thread）与 `Translations`（列出译本 + 解除 + 「Write the X
version」+ 搜索关联已有文章）两个子面板。改语言**不做乐观更新** —— 服务端可能因
组内语言占用而拒绝，先显示成功再回滚是骗人。

**「添加译本」零服务端痕迹**

菜单只把 `?translationOf=<id>&lang=<tag>` 放进 URL，compose 从 URL 取回；关掉就
什么都没留下。组在提交时才由 service 原子铸造。

**导入**

`import-site.js` 收集每篇的 `translation_group`，全部创建完成后按组把成员都链到
第一个（N 个成员 N-1 次调用，永不要求服务端合并两个组）；冲突只 warn 不中断。

**浏览器实测发现的两个真 bug**

1. **hono/jsx 按 `href` 去重 `<link>`** —— 文章页的自指 hreflang 与 `canonical`
   同 URL，被静默吃掉；而**没有自指条目的 hreflang 组会被搜索引擎整组忽略**。
   改为在 `BaseLayout` 用 `raw()` + `escapeHtml()` 输出 alternates，顺带把阶段 3
   为此砍掉的 `x-default` 加了回来。
2. **`Translation of "{title}"` 渲染成空** —— 又是阶段 2 那个 Lingui 陷阱：
   `i18n._()` 会把 ICU 完整求值，浏览器才知道的值必须把占位符原样传回
   （`{ title: "{title}" }`）。新增 `ui/compose/__tests__/ComposeDialog.test.tsx`
   守住这一类：断言服务端渲染出的 labels 仍带 `{title}` / `{language}`。

另外把组内语言冲突文案里的裸 tag 换成语言自称（`zh-Hans` → `简体中文`）——
作者在菜单里选的是后者。

**验证**：`check-tests` 261 files / 3374 tests 全绿；`check-lint`、`check-types`、
`check-format` 通过；i18n coverage 100%。浏览器走完 §16 验收基线：开启 → 无语言
字段发帖两篇（检测出 zh-Hans / en）→ 关联互为译本 → 两篇互见「Also available in」

- 双向 hreflang → 「Write the English version」→ compose 预填英文并显示
  「Translation of "mrlwg"」→ 发布后组自动成立 → 改语言被组内占用拒绝并显示服务端
  文案。**未做**：窄屏视觉（同阶段 3，环境 resize 不生效）。

### 17.8 菜单与关联体验的返工（用户实测反馈后）

**一个顶级入口，不是两个**

`Language` 和 `Translations` 合成一个 `Language`（meta 显示当前语言），面板里分
三段：语言单选 → `OTHER VERSIONS` → `ADD A TRANSLATION`。没有做三级菜单：站点
语言集通常 2–3 个，直接内联比多一层跳转更短；更重要的是**「某语言不可选」的原因
（组内另一篇已占用）只有紧挨着译本列表才说得清**。面板打开时顺带加载译本，所以
占用信息是免费的。

被占用的语言渲染成 disabled + `Taken`，`title` 给出占用者标题 —— 作者不必点下去
撞错误才知道。面板宽度加到 19rem（窄屏 20rem），复用 collection picker 已有的
`:has()` 变体写法。

**编辑文章确实可以改语言了（此前是假的）**

compose 的语言选择器在编辑态本来就渲染，但 `UpdatePost` 根本没有 `language` 字段，
值被静默丢掉 —— 是阶段 4 引入的 bug。现在 `UpdatePost.language` 走
`setThreadLanguage`（**整条 thread**），且**放在 update 最前面**：语言被拒时不应该
有任何别的字段已经写进去。

**关联候选改为服务端过滤**

新增 `posts.listTranslationCandidates(postId, {query, limit})` +
`GET /api/posts/:id/translations/candidates`。规则（thread root、已发布、语言不在
本组已占用集合内、两边不能都有组）属于 service，菜单只渲染返回值 ——
**菜单里出现的每一条点下去都成功**。匹配用 title/body 的 LIKE 子串扫描而非共享
FTS 索引：索引表达不了这些过滤条件，而这是作者对自己文章的一次显式操作，成本有界。

**「已关联中文文章能不能把自己改成英文」**：不能，也不应该。组内 `UNIQUE
(translation_group_id, language)` 就是这条规则，`assertTranslationLanguageFree`
在 service 层拦下并给出「哪篇占了该语言」的文案。返工后这条约束在 UI 上是**可见
的**（Taken + 置灰），而不是点了才知道。想改，先解除关联或改对方的语言。

顺带把冲突文案里的裸 tag 换成语言自称（`zh-Hans` → `简体中文`）。

**「写译本」改为原地开弹窗**

`#writeTranslation` 之前是 `location.assign('/new?...')` —— 整页跳到空白编辑页，
恰好在最需要上下文的时候把上下文丢了。现在优先调 `composeEl.openTranslation(
sourceId, tag)`（沿用 reply/edit 已有的 dialog API），只有页面上没有 dialog 时
（`/new` 自身、`showComposeDialog: false` 的页面）才回落到 URL —— URL 形式保留，
它是有效的深链，页面态 compose 仍从 query 读取。

弹窗顶部加 `Writing the {language} version of "{title}"` 横幅，位置与 reply 的
上下文横幅相同：**为某事打开的编辑器应该在作者动笔前就说清是为了什么**，而不是
埋在 publish panel 里两层深。两个占位符同样要原样传回（第三次遇到这个 Lingui
陷阱，已在 `ComposeDialog.test.tsx` 里断言）。

注意横幅要渲染在**两个**分支里：thread 布局和单帖布局是分开的模板，只改前者会
在最常见的单帖场景下完全不显示。

**验证**：261 files / 3383 tests；浏览器复验了单入口菜单、三段面板、占用置灰、
空态（两个 Write the X version + 搜索框）、候选过滤（同语言/已占用语言/已有组的
文章都不出现）、点选后即时关联并原地更新面板、以及「写日語版」原地开弹窗 → 发布
后停留在原帖且「Also available in English, 日本語」当场出现。

### 17.9 引用显示与通用文章选择器（第二轮反馈）

**Note 大多没有标题，所以到处不能只读 `title`**

之前译本行、候选行、compose 横幅都退化成显示 slug（`yidcy`）—— slug 是 URL，不是
名字。其实代码库里早有这条规则：`lib/post-meta.ts` 的 `getTitleCandidate`
（标题 → 引文片段 → summary → 正文开头 → 链接域名），浏览器标题和 OG 标签一直
在用。把它导出为 `getPostDisplayTitle(post)`，然后：

- `/translations` 与 `/translations/candidates` 各返回一个 `label`；
- `toApiPost` 加 `displayTitle`（**任何**引用某篇文章的客户端都需要它，不只是
  这个功能）。

无标题的日文 note 现在显示「これはコーヒーについての日本語のノートです。」。

**「Applies to the whole thread — replies are…」精简为「Applies to the whole
thread.」** —— 菜单入口本来就对回复隐藏，长解释是噪音。

**关联改用通用弹窗 `<jant-post-picker>`**

popover 里塞搜索框是错的形状：结果需要放得下真标题、需要键盘。新组件按
`jant-confirm-dialog` 的模式做（`ensurePostPicker()` + `pickPost(options)`
返回 `Promise<string | null>`），**对「为什么而选」一无所知** —— 调用方给文案和
一个 `search(query)` 函数，可用性规则仍留在服务端。菜单里退化成一行
「Link one you already wrote ›」。

实现上值得记的两点：搜索做了 200ms 防抖，并且用一个自增 token 防止**慢的旧请求
覆盖新结果**（防抖本身不解决这个竞态，已写成测试）。

**验证**：262 files / 3393 tests（含 picker 的 7 个契约测试与 label 派生的 3 个）；
浏览器复验：单行 hint、译本行显示真标题、picker 弹窗（自动聚焦、空态文案、
Escape 退出）、无标题日文 note 显示正文开头 + 「日本語」meta、选中后关联成功并
刷新出「Also available in English, 日本語」。

### 17.10 剩余的已知缺口

- 语言切换器与文章菜单文案是**英文硬编码**（与既有公开 UI 一致，D23），未走
  Lingui —— 与 `jant-post-menu.ts` 现状一致，要改应整体改。
- 关联已有文章用的是通用 `/api/search`，候选里不显示各自语言；选错由服务端
  `linkTranslation` 拦下并给出文案。要更好需要一个带语言的候选端点。
- §13 列出的范围外项（`zxx`、批量扫描复核 UI、机翻等）仍不做。

## 18. 生产化打磨（2026-08-08）

主流程做完后的四处瑕疵，目标是把这个功能提到可以部署的水平。

### 18.1 语言面板：被占用的语言不再是一行死掉的 "Taken"

原来的面板把同一件事说了两遍：单选组里 `English  Taken`（禁用），下面
「Other versions」再列一次那篇英文版。禁用行回答的是没人问的问题——作者**不能**
切到那个语言，看到它也没用。

- 单选组只留**能切**的语言（自己 + 空闲的）。
- 「Other versions」每行 `语言 · 标题`，带两个动作：整行是链接，`target="_blank"`
  新标签打开；末尾一个 icon 按钮解除关联，先关菜单再弹确认框（和 Delete 现有的
  顺序一致——弹在 popover 底下会抢焦点，也会抢 backdrop 点击）。
- 删掉了 group 级的「Leave this translation group」。逐行 unlink 覆盖得了它：
  `DELETE /api/posts/{对方id}/translations` 把**对方**移出组，service 在只剩一个
  成员时自己把组收掉，所以两篇的情形按一次就等于退组。两个控件说一件事是多的。

一个布局坑：`.post-menu-language-panel .post-menu-item-meta { flex: 0 0 auto }`
是给旧版写的（meta 是短短的语言名）。现在 meta 是标题，不收缩就会把 `↗` 挤出
可视区并被 `overflow:hidden` 硬切。删掉该覆盖，回到基类的 `flex: 1 1 auto` +
省略号。

### 18.2 「Applies to the whole thread.」删掉

菜单入口本来就对回复隐藏，这句是噪音。

### 18.3 译文继承原文的**形态**

`openTranslation` 之前永远从 note 开始，翻译一条 quote 要先手动切格式。现在从
源帖带过来：

- `format` 原样继承——格式是「说了什么」的属性，不是「用哪种语言说」的属性；
- quote 带 `sourceName` / `sourceUrl`，link 带 `url`。这些是**引用**，不是译文。
  正文是作者来这里要写的部分，别的什么都不抄。

只在作者还没打字时套用（`_hasContent()`）：fetch 落在 composer 打开之后，为了省
一次格式点击去覆盖人家的第一句话是很坏的交易。套用完重新 `_captureInitialSnapshot()`。

### 18.4 顶部横幅改成原文卡片 + 语言接缝

原来是一行 `Writing the 日本語 version of “xxx”`。左右对照太重；一行又不够——
只给标题，等于逼作者另开一个标签页看原文。折中：一张卡片，头部
`日本語 VERSION OF` + 原文标题（新标签打开），下面是原文正文，默认裁到 116px
带渐隐，`Show more` 展开。折叠/渐隐的机制和 reply context 是同一套，prose 复位
规则用 `:is()` 与它共享。

文案拆成 `translationContext` /`translationContextInLanguage`（只到 "… version
of"，标题自己一个元素）+ `translationContextOpen`，替掉
`translationOfInLanguage`。发布面板里的 `translationOf` 保留不动。

### 18.5 顺手修掉的三个真问题

- **`vi.mock("../confirm.js")` 路径错了**：组件在上一层，真实的确认框一直在跑。
  改成 `../../`，原有的 delete 测试才第一次真的测到东西。
- **BaseCoat 的菜单选择器压过两类选择器**：见 `lessons.md`。行内 icon 按钮要三个
  类才拿得回自己的宽高。
- **预填让 composer 看起来「有内容」**：`requestClose()` 对新帖问的是
  `_hasContent()`，于是什么都没写就关闭会弹「要不要存草稿」。新增
  `_hasWorkToLose()`：有内容，且（预填过的话）与预填后的快照有差异。
  `_handleDraftButtonClick`、`_renderSaveDraftRow`、`_renderAddThreadTrigger`
  问的是同一个问题，一并换掉。

### 18.6 验证

- 262 files / 3402 tests；lint、format、typecheck 全绿。
- 新增测试：post menu 语言面板 5 个（不再出现 Taken/hint、View+Unlink 两个动作、
  确认后 DELETE 打在**对方** id 上并刷新、取消则不动、free 语言列表），compose
  6 个（kicker + 新标签链接、原文折叠与 Show more、无正文时只留头部、quote 继承
  格式与引用、已打字则不套用、预填后关闭不弹确认而打字后会弹）。
- 浏览器复验（本地 19020，zh-Hans 主 + en/ja）：语言面板三段式与长标题省略、
  unlink 确认框与刷新、quote 的英文版落在 quote 格式且带 Steve Jobs /
  example.com/focus、发布后两边互相出现、`/new?translationOf=…&lang=ja` 的页面
  模式同样正确。验证后已删除测试帖并把多语言开关恢复为关闭。
- 三条新文案在 zh-Hans / zh-Hant 尚未翻译（`msgstr ""`，回退英文），与本功能其余
  公开文案的现状一致——等 `mise run i18n-translate` 那一趟统一处理。

### 18.7 对照区第二轮（同日）

第一版把整块做成「kicker + 标题 + 折叠正文 + Show more」。三处再改：

**语言标签下移到两篇文章的接缝上。** `English version of` 压在最上面，说的是
「下面这一坨是什么」；真正要标的是**边界**——上面是原文，下面是你写的译文。改成
卡片下方一条居中的细线 + `↓ Translating into 日本語`。文案也跟着从
「{language} version of」变成「Translating into {language}」，标题不再是文案的
一部分，自己一个元素。

**原文按 `prose` 正常渲染。** 之前复用了 reply context 那套缩排规则（标题降级到
`--type-thread-context-title`、`.prose` 强制 `font-size: inherit`）。翻译时**结构
本身就是要翻的东西**——标题得看起来像标题，列表得像列表。给正文加上
`e-content prose`，并把那几条共享选择器退回只服务 reply context（注释里写清楚为什么
不共享）。

**折叠展开换成固定高度滚动。** reply context 当初特意从内滚动改成 Show more，理由
是「展开就该真的展开」——那是对的，回复的父帖读一次就不再看了。翻译不是：读一段
写一段，两边都得在屏幕上。长文一展开就把编辑器顶出可视区，正是最需要同屏的时候。
所以 `max-height: min(15rem, 34dvh)` + `overflow-y: auto` +
`overscroll-behavior: contain`（滚到底不要带着整个 composer 一起滚），`tabindex="0"`

- `role="region"` + aria-label 让键盘和读屏也能用。标题下加一条细线：不然被截掉的
  半行看起来像布局坏了，而不是「滚动到这里」。`_translationExpanded`、渐隐、
  Show more、日期行一并删掉。

验证：3403 tests 全绿；浏览器复验了长文滚动（scrollHeight 493 / 视口 225）、标题
与列表按正常 prose 渲染、blockquote 走站点样式、接缝两侧细线等宽、quote 这种没有
正文的源帖只留卡片头 + 接缝、`/new?translationOf=…` 页面模式同样正确。

### 18.8 对照区第三轮：预览就是文章本身（同日）

前两版都在**重建**原文：只取 `bodyHtml` 丢进一个 `prose` 容器。这对 note 勉强
够用，对 quote 和 link 是错的——引用的出处、链接卡片的域名和标题都不在
`bodyHtml` 里，全被静默丢掉了。

**改成服务端渲染**：新增 `GET /_/post-preview/:postId`，用
`TimelineItemFromPost mode="detail"` 配上一组 display 选项
（`hideStatusBadges` / `footer.hideActions` / `footer.hideReply`）把交互 chrome
摘掉。复用真正的渲染器，不再有第二套要同步的 markup。它和 `/_/post-view` 的区别
是：那个渲染整条 Thread、用来替换整页，这个只渲染根帖、用来嵌在别处。

**注入进来的 markup 需要「收养」一下**（`_adoptTranslationPreview`，跑在
`updated()` 里）：

- **所有链接改成新标签打开。** 这是真 bug：预览里点任何一个链接都会把 composer
  整个导航走，未保存的译文跟着没。
- **摘掉文章的身份。** `data-post-id` / `data-post` / `.post-menu-target` 是文章
  菜单、键盘快捷键和 `refreshArticleView` 找文章的依据；DOM 里多一份原文的 id，
  它们就可能对着预览动手，以为那是真的卡片。

**标题后的外链图标去掉了。** 那个图标让整张卡片读起来像一篇 Link post，而不是
它本身。详情页渲染里本来就带自己的固定链接（头部那行日期），收养时已经指向新
标签，不需要再加东西。

**字号**用 `zoom: 0.85`。先试过在预览容器上改 `--type-content-scale`：没用——
自定义属性是在**声明处**代入的，`:root` 早就把它算进 `--type-content-body` 了，
后代继承到的是长度不是公式。改成在容器上重新派生一遍那 9 个 token 是可行的，但
把 root 的比例（`* 1.16`、`* 0.94`…）抄了第二份，会漂。`zoom` 一行搞定，而且它
连间距和线宽一起缩——「整页小一号」本来就该是这个意思，只缩字号会在小字周围留下
页面级的留白。正文实测 14.3px，比编辑器的 16.8px 小一档。不支持 `zoom` 的浏览器
退化成「按页面尺寸渲染」，偏大但不坏。

**横向滚动**：`overflow-x: hidden` + `overflow-wrap: anywhere` +
`pre`/`table` 自己 `overflow-x: auto` + 媒体 `max-width: 100%`。340px 宽的对话框
下实测 0 溢出，超长 URL 换行，代码块自己横滚。

**meta 一起继承**：collections、visibility、rating 和格式、引用一样跟着走 ——
它们描述的是这篇文章的位置和它谈论的东西，都不随语言变。只有文字是空的。

验证：3409 tests（新增 `/_/post-preview` 的 4 个路由测试 + compose 侧 4 个）；
浏览器复验 note / quote / link 三种源帖的预览（quote 带出「— Steve Jobs」，link
带出域名 + 标题卡片）、340px 窄框 0 横向溢出、collections=News、
visibility=latest_hidden、rating=4 全部预选且不触发「要不要存草稿」。

### 18.9 预览宽度与缩放方式的收尾（2026-08-09）

**标题没占满卡片宽度。** `preset.css` 的 `.post-detail-title { width: min(80%,
45rem) }` —— 页面上那是 Tufte 的标题栏比正文窄一档，在面板里就成了「长标题在 80%
处换行、正文却是满宽」，读起来像坏了。它是唯一一个把宽度写死、而不是读
`--layout-content-width` 的块，所以之前把那个 token 设成 100% 没管住它。

改起来还踩了一层：`preset.css` 的 `@layer components` 在第 82 行就闭合了，之后
的规则全是**未分层**的，而未分层声明赢过任何 `@layer` 里的规则，跟特异性无关 ——
`ui.css` 整个在 `@layer components` 里，三个类也打不过它一个类。用 `!important`，
和 `.post-menu-panel .post-menu-item`、`.compose-reply-context-body img` 是同一个
既有套路。（自定义属性不受这条影响：`--layout-content-width` 设在元素上就是赢，
因为那个元素上没有第二条声明在竞争——这也是 token 覆盖生效、`width` 覆盖不生效的
原因。）

**缩放为什么最后用 `zoom`。** 排过三种：

1. 改 `--type-content-scale` —— 无效，见 `lessons.md`。
2. 在容器上重新派生那 7 个 token —— 可行，但把 root 的比例抄了第二份；
   改成覆盖消费方（`.prose`、`.post-detail-title`、`h2`、`.feed-quote-content`
   …）可以不抄比例，代价是变成一份**选择器清单**，渲染器以后多一种卡片就会静默
   地按页面尺寸渲染那一块。
3. `zoom: 0.85` —— 对渲染器产出的任何东西都自动正确，而且连间距一起缩。这条最后
   胜出的关键不是「一行比九行短」，是 prose 的排版节奏是 `rem` 写死的
   （`p { margin: 1.4rem }`、`h1 { margin-top: 4rem }`），只缩字号会在小字周围
   留下页面级的留白，223px 高的框里差出整整一段。

`zoom` 的常见风险在这个位置上都不成立：预览里没有任何代码测量坐标（收养那一趟只
设属性），边框在外层未缩放的框上，文字渲染实测干净。不支持时退化成按页面尺寸
渲染，偏大但不坏。

验证：3409 tests 全绿；长标题现在与正文同宽（550/550），340px 窄框下标题与正文
同为 277px、横向溢出 0。

### 18.10 预览宽度：三套页面级宽度规则，不是一套

`.post-detail-title` 只是第一个。`preset.css` 一共用**三种方式**给文章块定宽：

1. `--layout-content-width`（桌面，token，好办）；
2. `.post-detail-title { width: min(80%, 45rem) }`（硬编码，绕过 token）；
3. `@media (max-width: 1024px) { …15 个选择器… { width: min(100%, 35rem) } }`
   —— 硬编码，而且看的是**视口**宽度，跟面板多宽毫无关系。

所以窗口一窄，预览里的正文就被压到 525px，卡片右边空一块。只覆盖 token 管不住
2 和 3。现在按 `preset.css` 那份清单在预览作用域里统一 `width: 100% !important`
（`!important` 是因为那些规则在 `preset.css` 的 `@layer components` 闭合之后，
未分层声明赢过任何分层规则）。

顺带补了 `.post-attached-group`：它在同一个 media block 里有
`min-width: min(100%, 35rem)`。那是个**下限**，窄面板里会超出框，而框是
`overflow-x: hidden`，超出的部分是被裁掉而不是能滚 —— 改成 `min-width: 0`。

验证方式（窗口没法真的改小）：注入一份未分层的 `<style>` 无条件复刻那个 media
block，然后对比面板内外。外面的正文 565 → 525（规则确实生效），面板内的标题和
正文稳定在 550，说明覆盖真的赢了、而不是规则根本没触发。

留了一个可选的后续：`preset.css` 里那份 15 个选择器的清单其实是桌面那份的重复，
把断点收敛成 `:root { --layout-content-width: min(100%, 35rem) }` 并给标题也开一个
`--layout-title-width`，就能删掉整个 media block，预览这边也不用再抄清单。属于页面
排版重构，影响面比这次大，单独做。

### 18.11 Language 面板：语言选择器降一级，Other versions 只留语言（2026-08-10）

两处来自实际使用的反馈，都是「面板里东西太多」的两个不同侧面。

**Other versions 不再显示标题。** 一行里语言 + 标题 + 外链角标 + unlink，标题必然
被截断（实测那条译文标题是 "This one is written in English, and nobody picked a
language."，在 285px 的面板里只能露出前几个字）。而识别一个译版靠的是**语言**，
标题只是确认 —— 现在语言当 label、标题挪到链接的 `title` 悬停提示和 `aria-label`
里，一个字也没丢，行反而空出一半宽度。

**unlink 改成文字。** 原来那个图标是 Lucide 的 `unlink-2`，也就是 `link-2` 去掉
中间那一横。所有「unlink」图标本质上都是「link 图标减掉点什么」，在 1rem 尺寸下
这个「减掉」不该让人眯着眼找。空出来的宽度正好用来直说 —— "Unlink"。同理没有用
`×`：那在一行文章链接旁边会被读成「删除这篇文章」，代价太高。

**语言选择器降到三级。** 它是**订正**动作，一篇文章一辈子可能改一次，而读译版、
加译版是日常。留在面板里平铺还会退化：双语站点且另一语言已被译版占用时，radio 组
只剩当前语言一行，还点不动 —— 纯噪音。现在是一条
`Change language  简体中文 ›`，进三级面板选；`free.length === 0` 时该行与整个
「加译版」区块一起不渲染（没有可切换的语言，也就没有可加的译版，更不该给一个
通向死面板的入口；当前语言在上一级菜单那行仍然可见）。Escape 一次只退一级。

**面板顺序（第二轮反馈后定稿）。** 先把 `Change language` 放在了最底下 ——
按「不常用的沉底」排的，但读起来是错的：上一级菜单那行写着 `Language 简体中文 ›`，
点进去这个值却出现在最后一行，像是答非所问。改成自上而下按**问题被问到的顺序**：

```
Change language        简体中文  ›   ← 这是什么语言（回答上一级那行的承诺）
─────
Write the 繁體中文 version      ›    ← 我能做什么（日常动作，无小标题）
Link a version you already wrote ›
─────
OTHER VERSIONS                       ← 已经有什么（随 fetch 到达，所以放最后）
English   ↗  Unlink
日本語     ↗  Unlink
```

三个变化各有独立理由：`Change language` 置顶是为了对上上一级的预览值；「加译版」
区块**去掉小标题**因为两行自己就说清了自己（多一行标题只是重复），代价是
"Link one you already wrote" 失去上下文，改写成 "Link a version you already
wrote" 才能独立成句；`OTHER VERSIONS` 沉底是因为它是 `#loadTranslations()` 的
结果 —— 放在上面的话，面板会在打开后一瞬间把下面的行整体向下推一截，正好推在
光标底下。

**顺带修掉一个既有 bug：面板的 ← 返回键会直接关掉整个菜单。** 文档级点击处理器
判定「点在菜单里面」用的是 `[role='menu']`，而那个属性在**列表**上，面板 header
在列表外面 —— 所以每一个 ← 都被判成点了外面。Visibility 面板侥幸没事，只因为它的
根节点上有 `data-visibility-panel`，恰好在那条选择器里。

**接着这个修法本身又踩了一次坑（值得记下来）**：第一版改成了判
`.post-menu-panel`，也就是所有视图渲染进去的那个容器 —— 看起来才是「点在下拉框
任何地方」的诚实写法，结果**真实鼠标点 Language 会把整个菜单关掉**，而所有测试
和我在页面里派发的合成点击全是绿的。原因是时序：真实点击时浏览器会在**两个事件
监听器之间**跑一次 microtask checkpoint，所以菜单项自己的 `@click` 已经把面板
重渲染完了，等文档级处理器拿到这个事件时，`target` 已经是一个**游离节点**，它的
子树到视图根为止，`closest` 再也够不到那个容器。而脚本里的 `el.click()` 永远暴露
不出这一点 —— 调用栈全程不空，中途不会重渲染。

最终判 `.post-menu-view`（每个视图的根，既包住 header，又是游离 target 自己的
祖先），两个方向都成立。回归测试用「在菜单项上再挂一个监听器调 `performUpdate()`」
把重渲染放到浏览器 checkpoint 的位置，去掉修复就会红（`aria-expanded` 变 `false`）。

**焦点**：`#focusAfterUpdate` 是 `querySelector(...)?.focus()`，所以目标必须
（一）可聚焦、（二）在**首帧**就存在 —— 译版列表是 `#openLanguagePanel` 里
`await` 出来的，首帧没有。选择器指向链接而非行 `<div>`，并在 fetch 落地后补一次
（仅当焦点还不在面板内），覆盖「所有其他语言都被占用 → 首帧空面板」这一种情况。
新增的测试去掉补的那次就会失败（焦点停在 `<body>`）。

验证：post-menu 24 tests（新增 6）+ 全套 3415 tests + check-lint + check-types；
浏览器复验三语组（zh-Hans 帖 + en/ja 译版 + 空闲的 zh-Hant）——面板 6 行按上面的
顺序渲染、行宽 269/285 无溢出；三级面板正确只列 简体中文（√）与 繁體中文；
← 从三级退回 Language 面板、再一次退回主菜单（此前会整个关掉）；Escape 同样逐级
退；无译版的帖子面板为 Change language + Write ×3 + Link。窄视口那一档只做了算术
估算（约 176px / 304px），Chrome 拒绝调整该窗口尺寸，没能实测。

## 19. 详情页归属、发布语言确认与设置简化(2026-08-11)

与作者讨论「/xyz 详情页点首页应该去 /ja」后落定的三件事。URL 设计(D1)不变;
补的是渲染层的归属规则。

### 19.1 新规则:文章页的骨架属于它自己语言的站

文章 URL 语言中立,`viewLang` 在详情页永远为空——但 `post.language` 就在行上。
`getNavigationData` 新增 `languageScope` 选项(详情页传文章语言),
`view-language.ts` 新增 `languageScopeBasePath()`。站内动线上这与「保持读者
来路视图」等价:日语文章只能从 /ja 表面到达。确定性渲染,一个 URL 一份字节。

顺带修了一个 M2 的漏项:`SiteHeader` 的 logo、抽屉品牌链接、搜索图标原来
硬编码根路径,连 `/en/archive` 列表视图里点站名也会掉回主语言。现在
`SiteHeader`/`SiteLayout` 接 `basePath`(= sitePathPrefix + 语言前缀),
logo、搜索、`isHomePage` 判定全部走它——`/ja` 由此获得完整的首页待遇
(home 头部样式、站点简介、页脚、compose FAB)。

### 19.2 发布时语言确认(改自 §6/§8 的静默检测)

compose 的「Detect」在**发布**时解析为**当前页面语言**(context,经
`composeContextLanguage` 链路传入:列表面 = 视图语言,详情页 = 文章语言)。
检测器降级为绊线:只有当它有把握地读出**另一种**语言时,才弹一个
action-sheet(「This looks like 日本語」→ Publish in 日本語 / Publish in
简体中文 / Cancel),Enter 确认检测语言,Escape 回编辑。一致或无信号则
直接以 context 发布,零打扰。显式选过语言永不弹(选择不被二次质疑)。

实现细节:`_submit` 在无需弹框时保持**完全同步**(`_maybeConfirmLanguage()`
返回 null 走原路径)——第一版无条件 async 让 15 个「点击→同步断言事件」的
测试红了,这不是测试的错,是提交时序无谓变化的真实回归。提交 payload 的
language 现在总是解析出的明确值(`_effectiveLanguage()`,fallback = context);
本地草稿仍存原始 `_language`(Detect 存 null,恢复后仍是 Detect)。
服务端检测兜底保留,继续服务 API/bot。

### 19.3 设置 → 语言:一个列表替代三块控件

- 开启态页面:主语言下拉 + Other languages chips + Reader URLs 图例合并为
  一个「Languages」列表——每行 = 语言名 + 它的地址 + Primary 徽标或
  [Make primary] [×]。改主语言从「在下拉里换人」变成行内动作,走同一个
  确认框。关闭态不变(Content language + 安静的开关)。
- 开启对话框:删掉「What turning this on does」四条 bullet(与页面开关的
  帮助文案重复),压成一行「Post addresses do not change, and you can turn
  this off again at any time.」;打标警告保留;primaryLanguageHelp 挪进
  对话框的主语言选择器下面(决策点上说明)。

验证:3428 tests + check-lint + check-types + i18n 100% 覆盖;本地 dev
端到端(enable → 发日语帖 → `/uypgv` 的 `<html lang="ja">` + logo/导航全部
`/ja/*`、`/ja` 有 home 样式且列出该帖、`/` 不列、主语言帖 chrome 在根、
`/zh-hans` 与 `/ja/{slug}` 301;移除有帖语言被正确拒绝)。

### 19.4 切换器的完备性 + 设置页地址可点击(同日跟进)

- **切换器规则补完**:默认 fallback 原来是「当前路径」,在 settings 等无
  per-language 对应物的页面上会铸出 `/ja/settings/language` 这种 404。
  新增 `isPerLanguageSurface()`(白名单,镜像 `langGet()` 表,两处需同步改),
  `buildLanguageSwitcher` 默认 fallback 改为:有对应物 → 当前路径,没有 → `/`。
  规则从此一句话覆盖所有表面:**切换器带你去那个语言的站;有对应物去对应物,
  没有去首页;永不产出 404**。白名单方向是 fail-safe:未来新增的
  非语言页面自动落到首页而不是死链。
- **Dashboard 与语言视图的边界(设计意图,回应「settings 只有一个是否合理」)**:
  合理且有意为之。语言视图只分叉**读者流**;dashboard 是作者的单一驾驶舱,
  不属于任何语言视图,其显示语言由「界面语言」设置决定,与进入时的来路无关。
  从 /ja 进 settings 后想回去,切换器一次点击到 /ja(上一条保证了这个链接存在)。
- **设置 → 语言列表的地址可点击**:每行 URL 变为 `target="_blank"` +
  `rel="noopener noreferrer"` 的链接,hover 下划线。

### 19.5 第三轮文案与交互打磨(用户反馈后,2026-08-11)

- **移除语言的拒绝变为行内错误 + 出路链接**:新增 `LanguageInUseError`(带
  postCount),remove 路由把它本地化(复数 + 语言原生名:「还有 2 篇日本語
  文章。先修改它们的语言,或保留该语言。」),设置页渲染在该语言行的下方
  (`role="alert"`),多语言开启时附「查看这些文章 →」链接指向 `/{lang}/archive`
  新标签打开。规则本身(零帖守卫)一字未动——语言标签是关于文本的事实,
  批量重标或放行孤儿都是更差的选择(讨论记录见对话;要点:孤儿内容不可见、
  重标即说谎、根视图的语言承诺不可随配置漂移)。已知小缺口:计数含草稿,
  archive 只列已发布。
- **多语言开关从 checkbox 改为按钮**:checkbox 暗示即时生效,但实际要走确认
  对话框,取消后还得手动把它掰回去(#syncMultilingualCheckbox hack)。改为
  关闭态 `[Turn on multilingual content]`、开启态列表下方安静的
  `[Turn off multilingual content]`,hack 随之删除。
- **文案**:contentLanguageHelp →「你写作使用的语言,也是读者和搜索引擎看到
  的语言」;打标警告 → 明确说「尚未标记语言的文章」(重开场景下 count 只是
  NULL 帖数,旧文案「你已有的 N 篇文章」在此误导);确认按钮按 count 分档
  (有帖「Mark posts and turn on / 标记并开启」,零帖「Turn on / 开启」——
  不承诺不会发生的动作)。
- **切换器加 globe 图标**(label 之前,14px,72% 不透明度)。**不加国旗**:
  国旗指国家不指语言——zh-Hans/zh-Hant/en 都没有唯一对应的国旗,行业惯例
  (W3C i18n)明确反对用国旗表示语言。
- **「Also available in …」移到正文之前**:这行字的目标读者是读不懂正文的人,
  不该让他们滚过读不懂的整页去找出口(Wikipedia/MDN/NYT 双语的先例都在顶部)。
  对所有文章统一放顶部,不按长度分叉(条件布局 = 不一致)。

### 19.6 第四轮:译本链接入 meta、icon-only 切换器、设置页任务化(2026-08-11)

- **译本链接不再是独立一行,搭日期的车**(§19.5 的顶部横排被否:辅助功能不能
  高调)。新组件 `PostTranslationLinks`(12px globe + 各语言原生名,无文案;
  完整句子在 aria-label「Also available in {language}」)经
  `PostFooterDisplayOptions.translations` 传入:**有标题的文章**跟日期一起在
  标题下的 header meta 行(长文读者在滚动前就能看到出口),**其余格式**跟
  footer 的日期在一起(短帖一屏可见,footer 即出口)。区分逻辑与日期完全同轨,
  不新增分叉。Thread 上挂在读者落地的那篇(祖先可能被折叠)。
- **切换器 trigger 改为 icon-only**(globe + chevron):trigger 上的当前语言名
  服务不了任何人——读得懂的人正在读这个语言,想切走的人读不懂它。菜单里
  依旧每个语言用自己的名字。aria-label 不变。
- **设置页从「功能开关」改为「任务动作」**:
  - 关闭态:「Multilingual content」块的按钮是 `+ Add language`(作者的真实
    意图是「加一种语言」,不是「启用一个 feature flag」;Shopify Markets 同款
    模式)。对话框标题「Add a language」,确认按钮「Add language」——打标
    副作用由紧邻其上的警告块陈述,按钮不再复述(修订 §9.2 的「按钮说清打标」:
    当时按钮叫「确认」才有该规则,现在警告就在按钮上方一寸)。
  - 开启态:语言列表块之后,对称的「Multilingual content」块:一行现状描述
    (「每个语言都有自己的首页、归档和订阅源。」)+ `Turn off` 小按钮,
    与 Add language 不再挤在一起;确认对话框不变。
  - **修复**:`unmarkedPostCount === 0` 时不再显示打标警告块。旧文案
    「你还没有文章」在「全部文章已有标记」的重开场景下是错的;没有副作用
    就不该有警告,整块隐藏。`enableMarkWarningEmpty` 删除。
- 本地 dev 实测:无标题中文帖译本链接在 footer 日期旁;有标题日语文章在
  标题下 meta 行;trigger 可见文本为空、globe 存在。

### 19.7 第五轮:meta-row 方案回滚,设置页定为「状态 + 行内开关」(2026-08-11)

- **译本链接:§19.6 的 meta-row 集成整体回滚**,恢复 §5 原设计——所有格式统一
  在文章之后一行安静的完整句子:「Also available in 日本語」(链接,hreflang,
  语言原生名)。用户实测反馈:header meta 行右对齐的变体难看,按格式分叉的
  位置不统一;原句式反而最好。**不用下拉框**:个人博客译本常态是 1–2 个,
  下拉把唯一的链接藏进一次点击(Wikipedia 用下拉是因为它有 300 种语言)。
  `PostTranslationLinks`、`PostFooterDisplayOptions.translations` 及相关
  plumbing 全部删除。
- **设置 → 语言 定稿为三段式**:
  1. Site:内容语言(关)/ Languages 列表(开)。帮助文案缩短为
     「你写作使用的语言。」(SEO 半句删除)。
  2. **Multilingual content 独立成节**(border-t,与 Dashboard 同级)——解决
     「内容语言字段与多语言块距离太近产生歧义」;节内为一行描述 + 状态徽标
     (**On/已开启** / **Off/未开启**)+ 行内链接动作(**Turn off/关闭** /
     **Turn on/开启**)。关闭后状态一目了然,重开入口不再是让人懵的
     「+ Add language」。
  3. Dashboard:不变。
- **开启对话框**:标题「Turn on multilingual content / 开启多语言内容」
  (与点击的动作一致),确认按钮改为通用 **Save/保存**(§19.6 的
  「Add language」按钮被否:这是一个设置表单,提交按钮该是保存;打标副作用
  由紧邻的警告块陈述)。`enableConfirm` 标签删除,复用 `save`。
- dev 实测:有标题/无标题两种帖的译本行都在 article 之后、无 header 变体;
  开关状态切换与重开路径可见。

### 19.8 第六轮:命名、行菜单、重开守卫、即时刷新(2026-08-12)

- **命名**:中文译文层面「多语言内容」→「多语言」(节标题、弹窗标题、toast
  全部统一;英文源文案保持 "Multilingual content" 的语法完整性)。
- **语言列表行动作折叠**:「设为主语言」「删除」是一年一次的操作,常驻按钮
  给了它们日常级的显眼度。改为每行一个「⋯」菜单(aria-haspopup,菜单项
  「设为主语言」/「删除 {语言}」,删除为 destructive 色),主语言行只有徽标。
  外点 + Escape 关闭,与 picker 互斥,有测试。
- **重开守卫(真实的不变量漏洞)**:`enable()` 原来整体重写语言列表而不检查
  「有帖语言 ⊆ 新列表」——关闭→重开时在弹窗里删掉一个语言,它的文章会从
  所有视图消失(remove 守卫的旁路)。补上:`posts.listLanguagesInUse()`
  (GROUP BY language)+ enable 内校验,违反抛 `LanguageInUseError`(现在
  携带 language + postCount),路由统一本地化(与 remove 同一句文案:
  「还有 N 篇{语言}文章。先修改它们的语言,或保留该语言。」)。**弹窗内联
  错误**:`_enableError` 显示在对话框内(toast 会被 modal 顶层盖住,永远
  看不见——顺带修了前缀冲突错误同样不可见的旧问题)。已知取舍:一次只点名
  第一个缺席语言。服务层测试覆盖拒绝与「换座位不算丢」两个方向。
- **开关后的界面即时性**:开启/关闭多语言改变的是页面自身的 chrome(右上角
  切换器的有无),只有服务端能重新渲染它——成功后 `window.location.reload()`
  (与界面语言修改同一先例)。不走 header fragment 刷新:同一请求内
  `appConfig` 是设置写入前的快照,渲染出的仍是旧 header。
- dev 实测:重开删语言被拒(中文、点名语言与数量);含全部有帖语言则成功;
  守卫在含多种历史语言的库上逐一点名。

### 19.9 第七轮:文案精修与弹窗守卫的可操作化(2026-08-12)

依据 AGENTS.md 新增的中文文案规范(全角标点、无主语优先、反翻译腔)执行:

- **多语言区块描述**(zh):「为每种语言提供独立的首页、归档和订阅源。发布时
  可以选择语言,也可以把不同语言的文章互相关联为译本。」两种状态共用同一段
  描述(功能是什么不随开关变),`multilingualOnHelp` 删除。
- **「开启」→「启用」**:zh 目录 msgstr 层面全量替换(状态徽标「已启用」、
  动作链接「启用」、弹窗标题「启用多语言」、toast「多语言已启用。」);
  「关闭」不动。**未启用状态不再显示徽标**——默认态无需宣告,一个「启用」
  链接即是全部;「已启用」徽标只在开着时出现(`statusOff` 删除)。
- **保证行**(zh):「启用多语言后,文章地址不会改变;之后也可以随时安全地
  关闭。」(原句缺主题、逗号半角,被用户点名看不懂。)
- **弹窗守卫错误可操作化**:enable 路径拿到专属文案——「还有 N 篇{语言}文章,
  但列表里没有这个语言。把它加回列表,或先修改这些文章的语言。」并且响应带
  `language` 字段,弹窗在错误旁渲染一个「添加 {语言}」按钮,一键把缺席语言
  放回列表(用户实测截图:错误提到繁體中文,但弹窗里根本没有它的任何入口)。
  remove 流程保留原「保留该语言」措辞(在列表行语境成立)。
- **全角标点清理**:此前几轮我加入的 zh 译文里混有半角逗号/分号(每文件
  5 处),按新规范全部改为全角;ICU 语法逗号不受影响。

### 19.10 第八轮:「Also available in …」的归属与死链(2026-08-13)

位置不动(§19.7 的结论仍然成立:所有格式统一在文章之后一行完整句子),
改的是它在页面上属于谁:

- **它是文章元数据的最后一行,不是漂在页脚下面的一句话**。原样式
  `--type-ui-meta`(15px)比它上面的日期/合集行(`--type-ui-hint`,13.5px)
  还大,又隔着 43.5px 的空白,读起来像正文结束后遗落的一句。改为与页脚同
  号同色,间距收到 22.5px(即文章自身的 `py-6` 下内边距,与「正文 → 页脚」
  的 24px 同一节奏)。
- **加站点切换器那颗 globe**(0.95rem,取合集图标的灰度):页面上唯一已经
  表示「语言」的记号,也让这一行与它上面的「合集图标 + 名称」成对。
- **语言名恢复下划线**:全局 `a` 规则把这里的下划线抹掉了,而这行字的读者
  恰恰读不懂包着语言名的那句英文,链接必须自己看起来像出口。
- **修:草稿/私密译本不再被公开宣传**。`buildTranslationLinks` 取的是整个
  translation group,不筛状态——而草稿与私密文章对读者都是 404。于是一篇
  发布的文章会挂出一条 404 链接,`hreflang` 也指向同一个 404。改为只保留
  `status === "published" && visibility !== "private"` 的兄弟;被滤掉之后
  切换器自动回落到该语言首页(§5 的兜底),永远落在真实存在的页面上。
  回归测试:`language-routing.test.ts` 的「never points a reader at a
  draft/private translation」。

已知(与本轮无关,另一趟活):public 目录的中文翻译尚未开始(482 条里 480 条
为空),所以中文页面上这行仍显示英文源文案。

### 19.11 第九轮:切换器说出「你在哪个语言」(2026-08-13)

用户实测:一篇日语文章的页面上没有任何地方说明这是日语站,连点开右上角
切换器也看不出来。两处都改:

- **菜单里的当前语言原本没有标记**。`.site-header-more-link-active` 只是
  一档颜色加深,而那一档与 `:hover` 完全相同——鼠标扫过哪一行哪一行就长得
  像「当前」。`aria-current="true"` 一直是对的,只有视觉是空的。现在当前行
  用 primary 色 + medium 字重 + 一颗 4px 圆点(与移动端抽屉里那颗同款)。
- **trigger 在非主语言时写出语言名**(部分推翻 §19.6 的 icon-only)。
  §19.6 的理由是「读得懂的人正在读这个语言,想切走的人读不懂它」——那句话
  只在主语言成立。主语言是站点的默认形态,不必宣告;`/ja`、`/zh-hant`
  以及任何一篇非主语言文章都是它的变体,从搜索结果、分享链接、或一篇
  别的语言的文章落进来的读者应该不用点开任何东西就知道自己在哪一支。
  规则与 composer 的语言 pill 完全同构(没话说时只留 globe,状态偏离默认
  时才写出名字)。
  - `LanguageSwitcherOption` 新增 `isPrimary`,视图层不再靠数组下标推断。
  - 可见文本用语言自己的名字,所以 `aria-label` 改用既有的
    「Language: {language}」(与 composer pill 共用同一条 msgid),否则
    朗读出来的「Language」会丢掉这个控件唯一说的那件事。
  - 名字上限 7rem(窄屏 4.5rem)带省略号,长 endonym 不会顶坏头部。
  - ≤480px 原本整个隐藏(抽屉里有语言段落)。现在只隐藏**没有名字的那一
    种**:一颗光秃秃的地球在手机上确实只占地方,但「你在日语站」这句话要
    活下来。`.site-header-lang-named` 由服务端加,不依赖 `:has()`。

未验证:≤480px 的实际拥挤程度。本次浏览器会话的视口固定在 1200px,无法
真机复现;若手机上顶栏显挤,把 `.site-header-lang:not(.site-header-lang-named)`
改回 `.site-header-lang` 即可退回原状。
