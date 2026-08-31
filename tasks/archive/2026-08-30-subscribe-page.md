# 订阅页 `/subscribe`

日期：2026-08-30
状态：**已实现**（5 个提交：`51a50183` `6dd5ada9` `d07dc240` `86573ffe` `c5b4f6a2`）。
原计划 4 个实现提交 + 1 个实测查出的文案修正。

## 0. 要解决的问题

导航里默认有一项 `RSS`，指向 `/feed`，点进去是一屏 Atom XML。这是站点上唯一一个把普通读者
带进死路的入口。

后果是作者得手写解释。owenyoung.com 现在就在 about 页里写着 feed 地址和 latest/featured
的区别 —— 而那段散文会过期：改一次 `mainRssFeed`，about 页立刻是错的，且没人会想起来。

同时读者面对 `<link rel="alternate">` 吐出的 `Main feed` / `Latest posts` 两条，没有任何
地方解释它们的差别。这个差别是 Jant 特有的，自动发现表达不了。

---

## 1. 现状（先读，避免重造）

已经有的，不要重做：

- **`/settings/general` 已有 feed 地址列表 + 复制按钮**。四条（main/latest/featured/archive），
  `GeneralContent.tsx:179-220` 是文案，`jant-settings-general.ts:533` 是剪贴板逻辑、`:546`
  是那个 `readonly input + 绝对定位复制按钮` 的行组件，toast 文案 `Feed URL copied.`
- **`/archive`、单合集页、聚合合集页已有 RSS 图标**，而且带当前筛选条件：
  `ArchivePage.tsx:1391`、`CollectionPage.tsx:281`、`SmartCollectionPage.tsx:196`
- **自动发现已经吐三条**：main、对侧的 latest/featured、当前页的 feed（`BaseLayout.tsx:501-525`）
- **公开页已经在跑 Lit**：`SiteLayout.tsx:753` 的 `<jant-media-lightbox />`；toast 容器在
  `BaseLayout.tsx:566`。公开页加 Web Component 不需要新基建。
- **系统导航 URL 每次渲染从常量解析**（`view.ts:551-556`，注释明写「stale DB values … are
  always corrected at render time」），但**标签是按行存的，不重解析**（`view.ts:548`）。

缺的：

- `/` 和 `/featured` **没有** RSS 图标 —— 恰好是最多人看的两个页面
- `/collections` 目录页每一行**没有** RSS 图标（`CollectionDirectory.tsx`）
- `docs/` 下**没有** feeds 这一篇
- `/settings/general` 的 Feeds 区块**一个 docs 链接都没有**

---

## 2. 决定与理由

这几条都是来回讨论过才定下的，实现时如果觉得某条站不住，**改这份文档并写清为什么**，
不要默默偏离。

### 2.1 路由用 `/subscribe`，不用 `/feeds`

`/feed` 和 `/feeds` 差一个字母、语义完全相反（一个 XML 一个 HTML），是给自己埋雷。

`/subscribe` 按**读者意图**命名而非实现命名 —— 读者的问题是「我怎么关注这个站」。符合
可分享 URL 的单个小写词约定，且以后要加别的订阅方式不用改名。

不用 `/follow`：social 语义跟 Jantelagen 的立意直接冲突。

### 2.2 页面固定列三条，**不做任何按站点数据的派生**

主 feed、精选、全部。所有站点长得一样。

一度设计过「站点没有精选帖就不列 featured」「没有 latest_hidden 帖就不列 archive」的派生。
**撤掉**，理由：

- 一致性有实质价值 —— 文档、截图、口口相传都对得上，不会有「为什么我的站少一条」
- **页面因此完全不碰数据库**：纯 `appConfig` 渲染，可缓存、无 service 依赖。比「查询很便宜」
  更好的是根本不查。

### 2.3 archive feed **要列**

一度决定不列，理由是「'不在 Latest 显示' 意味着别推给人，feed 是推送渠道」。**这个推理不成立**：
「不在 Latest 显示」是**首页编排**决定，不是**别通知**决定；主动跑到订阅页的人比首页访客
opt-in 得多，把他们当需要保护的对象是家长作风。

而且证据在代码里：`archive` 的默认导航标签是 **"All"**、`defaultPlacement: "header"`
（`constants.ts:149-153`）。项目本来就把「全部」当一等公开面。

订阅个人微博客最常见的意图就是**订阅这个人**。

**措辞决定它会不会被误选**：不要写「全部帖子」（听起来像默认项），写「全部，包括不在
Latest 显示的」—— 说清多出来的是什么。想要一切的人一眼认出，只看主线的人一眼排除。

### 2.4 合集 feed **不列**，那条 `{page}/feed` 的规则也不写在页面上

判据（用它可以判完所有 feed）：

> **列出一个 feed，当且仅当：它服务一个常见的订阅意图，且没有更好的就近入口。**

- 主 feed：常见意图，无他处 → 列
- 精选：latest/featured 的分辨正是作者现在要手写解释的那件事 → 列
- 全部：常见意图（见 2.3），唯一别处入口是 `/archive` 上一个很小的图标 → 列
- **合集：罕见意图**（单作者站上「我只要他写读书的部分」很少），**且有明显更好的就近入口**
  —— 你正在看那个合集时页面上的 RSS 图标 → **不列**

`feed.ts:4-6` 那条「a feed is a sub-resource of the page it represents」是个漂亮的心智模型，
但如果它省不掉任何一条罗列，它就只是装饰，而且会邀请读者去盘算「有哪些列表页呢」。搬进
`docs/feeds.md`。

### 2.5 导航：**新增** `subscribe` key，不重定向 `rss`

一度打算把 `SYSTEM_NAV_KEYS.rss.url` 直接改成 `/subscribe`（成本为零，现有站点自动跟上）。
**否掉**，三个理由：

1. **`rss → /feed` 和 `subscribe → /subscribe` 是两个不同的东西。** 有些作者的读者是技术圈的，
   故意要直链 XML。重定向会永久销毁这个能力，之后只能建 custom nav item，丢掉 i18n 标签和
   `rssFeedsEnabled` 自动隐藏。
2. **语义诚实。** key 叫 `rss` 却指向 HTML 页面是数据模型里的谎话。主题和外部脚本读导航数据
   （AGENTS.md 把这些当契约），按 `systemKey === "rss"` 画 RSS 图标的主题会给 HTML 链接画上图标。
3. **append-only profile 就是为这事设计的**，v1→v2 已有先例和注释。重定向会**悄悄改掉每个
   现有站点导航项的去向**，违背 append-only 想保护的东西。

代价：**现有站点不自动获得改进**，包括 owenyoung.com。可接受 —— 作者在设置页翻两个开关即可
（见 §3.5），不该由我们替所有人改导航。

### 2.6 标签：v3 默认用 `Subscribe`

早先曾主张保持 `RSS`，理由是「导航标签作者天天看见，『RSS』是惰性机械词，『订阅』是关系词，
会让受众变得可感」。**两个 key 并存后这个反对不成立了** —— 选择存在了：嫌 Subscribe 太有
受众感的作者可以改用 `rss` key，或直接改标签（标签按行存，不重解析）。默认值可以取对读者
更友好的那个。

位置留 `more`。`/subscribe` 是**一次性工具页**（读者一辈子去一次），跟 Featured / All /
Collections 这些反复回去读内容的分区并排放进 header 是范畴错误。`more` 现在装的是
Collections + RSS + Settings，本来就是「溢出 + 工具」桶。

### 2.7 列表页上的 RSS 图标**继续直链 XML**，不改指 `/subscribe`

看着像遗留了同样的死路，但不是：那些图标的全部价值在于**带着当前筛选条件**
（`/archive/feed?collection=x&year=2025`），`/subscribe` 表达不了。而会去点 RSS 图标的人，
定义上就是认得这个图标的人。

**图标服务懂行的人，导航项服务不懂的人。** 两拨受众，两条路径。

### 2.8 无压力约束（硬线）

Jant 的立意是无压力公开写作。这个页面本身**没有反馈回路** —— 作者永远不会从它知道有没有人
用过，所以机制上不产生压力。但要守住两条：

- **永远不显示订阅者数量。任何地方，包括后台。** RSS 请求的 User-Agent 常带 subscriber
  count —— 不解析、不统计、不留口子。
- **文案是说明书不是邀请函。**「这个站发布 Atom feed，地址是……」是工具；「订阅以免错过」
  「保持更新」是渠道。这批词 AGENTS.md 本来就禁了。

---

## 3. 实现

分 4 个 commit，按顺序。每个 commit 自身可用、可验证。（原计划 5 个，导航的 key 和
那对对照文案没法拆开，见 §3.3。）

### 3.1 commit 1 — 复制字段（**已完成**）

**偏离计划：不用 Lit 组件。** 原计划是抽一个 `<jant-copy-field>` Lit 组件给两处共用。实现时
发现它站不住：

lit-html **追加**自己的 parts 而不替换既有子节点，`createRenderRoot()` 里 `this.innerHTML = ""`
在子节点解析之前就跑了，所以服务端写在标签里的 fallback 不会被清掉 —— 实测渲染出
`<input data-fallback><!---->`，两份叠着。仓库里唯一一个真有服务端 fallback 的组件
（`setup.tsx:94` 的 locale picker）因此把 fallback 放成**兄弟节点**，靠
`jant-locale-picker:not(:defined)` 的 CSS 藏住组件本身。

而 `/subscribe` 的全部内容就是那三个地址。用 Lit 渲染意味着无 JS 时页面只剩一个标题 ——
比它要取代的裸 XML 还糟，也会是全站唯一一个内容不由服务端渲染的页面。这个 fallback 不是可选项。

所以改成**服务端渲染 + 委托增强**，也就是 `src/client/` 里那批 enhancer 的既有做法
（`form-enter-submit.ts` 等）：

- `src/lib/copy-field.ts` —— 契约：增强器要找的 `data-*` 钩子名 + 两处共用的 class 常量
- `src/client/copy-field.ts` —— 行为：委托在 document 上，所以设置页 Lit 在 load 之后
  才渲染出来的那几行也自动覆盖到
- `src/ui/shared/CopyField.tsx` —— 服务端标记
- `jant-settings-general.ts` 的 `_renderFeedUrl` 发同样的标记，删掉自己那份剪贴板逻辑

行为共用（难的那部分），标记因为分处 JSX 和 Lit 两种模板语言而写两遍，用 `lib/copy-field.ts`
的 class 常量挡住漂移。**lit-html 不能插值属性名**，所以 Lit 那边钩子名是字面量，由
`jant-settings-general.test.ts` 断言它跟增强器对得上。

两个保住的细节：

- `@click` / `@focus` 时 `input.select()` —— clipboard API 在非 HTTPS 或权限被拒时会抛，
  那时读者至少能手选。**这是无 JS 时的正确状态**
- 服务端把按钮渲染成 `hidden`，由增强器揭开。没有脚本时留下的是一个可选中的 input，
  而不是一个按了没反应的按钮

设置页行为不变（19 个既有测试仍通过），新增 `src/client/__tests__/copy-field.test.ts` 7 个用例。

### 3.2 commit 2 — `/subscribe` 页面与路由

**新文件** `src/routes/pages/subscribe.tsx`（照 `featured.tsx` 的形状写）+
`src/ui/pages/SubscribePage.tsx`。

- `app.tsx` 在 `app.route("/featured", featuredRoutes)` 一带挂 `app.route("/subscribe", subscribeRoutes)`
  —— 必须在 `app.route("/:lang", languageRoutes)` **之前**，理由同那里的注释
- `RESERVED_PATHS` 追加 `"subscribe"`（`lib/constants.ts:8`）。**开工前先确认没有现存站点的
  post/collection 占了这个 slug**（查 `path_registry`）；pre-1.0，冲突就迁移
- `PER_LANGUAGE_SURFACES` 追加 `"/subscribe"`（`lib/per-language-surfaces.ts:16`），并在
  `language.tsx` 的 `langGet()` 表里注册 —— 那个文件的注释明写「两者必须一起改」
- `rssFeedsEnabled` 为 false 时路由 404，与 feed 路由一致
- `alternateLanguages: buildSurfaceAlternates(c)`
- 进 sitemap（`routes/feed/sitemap.ts`，跟 `/archive` `/featured` `/collections` 一样），
  不 noindex

三条地址用 `toAbsoluteSiteUrl` 给**绝对 URL**（读者要粘进阅读器的是完整地址），语言视图下
带语言前缀。

**页面结构**（一张卡 + 一列附注，视觉层级本身就是「选哪个」的答案；四张同等的卡等于把选择
甩回读者，就是 about 页困惑的原样搬家）：

```
订阅
把地址放进任何 RSS 阅读器。

┌ 主 feed ────────────────────────────────┐   ← .card，全页唯一一张
│ 新发布的帖子 / 精选的帖子                   │   ← 随 mainRssFeed 变
│ [https://….com/feed          ] [复制]     │
└─────────────────────────────────────────┘

精选   https://….com/featured/feed  [复制]  只有精选的帖子
全部   https://….com/archive/feed   [复制]  包括不在 Latest 显示的

筛选过的存档视图和每个合集也有自己的 feed —— 页面上的 ⌁ 图标就是。
```

- 主 feed 那条**要说清它现在是什么**（`appConfig.mainRssFeed` 是 latest 还是 featured），
  读者看到的应是「新发布的帖子」或「精选的帖子」，不是抽象的 "main feed"
- 下两条分组的心智模型直接复用 `constants.ts:142-146` 那条注释（Featured/All 是同一个列表的
  两个宽度），页面结构和导航结构互相印证
- BaseCoat 语义类 + `tokens.css`，不硬编码颜色间距；单列、移动优先

### 3.3 commit 3 — 导航新增 `subscribe` 系统项（含原 commit 4 的文案）

**与计划的两处偏离，都在实现时才看清：**

**偏离一：原 commit 3 和 commit 4 合并成一个。** 计划把「加 key」和「写那对对照文案」拆成
两个提交，但 `SYSTEM_NAV_DESCRIPTIONS` 是 `Record<SystemNavKey, ...>`，加 key 就必须同时给
描述，否则类型都过不去。而且那两行本来就是一对，拆开提交等于让第一个提交留下一行凑数的文案。

**偏离二：那个「重复」的特判不是重复，是 catalog 放置。** 计划说
`NavigationContent.tsx:262` 特判了 `key === "rss"` 的描述、把 `navigation-labels.ts` 里那条
覆盖掉了，属于该清掉的重复。**错了** —— `lingui.config` 按路径切目录：

- `routes/dash/**`、`ui/dash/**`、`routes/auth/setup.tsx` → `locales/settings/` 目录，**翻译**
- 其余一切 → `locales/public/` 目录，**只维护 en**（公开面在每个视图下都是英文）

`navigation-labels.ts` 在 `ui/shared/`，所以那里的描述全都进了不翻译的目录。那个特判存在的
理由就是把 RSS 那条挪进 `ui/dash/` 从而拿到翻译。照计划「去重」会把它也变成英文。

正确的修法不是留着特判，是**把整张描述表搬到 `ui/dash/appearance/system-nav-descriptions.ts`**。
顺带修掉一个既有缺陷：另外五条描述此前一直没被翻译，现在七条一起进了 settings 目录，
zh-Hans / zh-Hant 都补了译文。

导航**标签**留在 `ui/shared/navigation-labels.ts` 不动 —— 它们渲染在公开站点导航里，本来
就该是英文。

**已做的改动：**

- `SYSTEM_NAV_KEY_VALUES` 追加 `"subscribe"`；`SYSTEM_NAV_KEYS` 追加该项
  （`defaultLabel: "Subscribe"`、`url: "/subscribe"`、`defaultPlacement: "more"`）
- `DEFAULT_NAVIGATION_PROFILES` 追加 v3 = v2 把 `rss` 换成 `subscribe`，版本号指向 3。
  **v1/v2 一个字没动**
- 新增 `FEED_NAV_KEYS` / `isFeedNavKey()`（`types/constants.ts`），两处 `rssFeedsEnabled`
  过滤改走它：`lib/navigation.ts` 的服务端投影、`jant-nav-manager.ts` 的
  `#isVisibleInPreview` 预览。两处都加了测试
- `getSystemNavDescription` 增加 `values` 参数，`NavigationContent.tsx` 不再自带那份文案。
  注意 `Translator` 要用仓库自己的 `i18n/i18n.ts` 里的 `I18n`（它声明了
  `_(descriptor, values)`），不是 `@lingui/core` 的 —— 后者的 `_` 只有 `(descriptor)` 和
  `(id, values)` 两个重载，传描述符 + values 过不了类型

**关于迁移：结论仍是不需要，但计划里给的理由是错的。**

计划说「两边都是 `text(..., { enum })`，Drizzle 只在 TS 层收紧，不生成 CHECK」。实际上
`nav_item.system_key` **曾经**有过值白名单约束：`0000_baseline.sql` 是四个值，
`0010_futuristic_preak.sql` 重建成六个。真正的理由是**后来的迁移把它去掉了** —— 当前
`schema.ts` 不再声明 `chk_nav_item_system_key`，`meta/0034_snapshot.json` 里没有它，本地已
迁移的 D1 实际 DDL 里也只剩 `chk_nav_item_shape`。三处都查过了。

（这条值得记住：`text({ enum })` 本身确实不产生约束，但这张表另外用 `check()` 显式声明过
同名约束，光看列定义会得出错误结论。）

### 3.4 commit 4 — 就近入口与文档（**已完成**，原 3.6）

**偏离计划：不给 `/` 和 `/featured` 加 RSS 图标。**

计划里这条是我自己提的，理由是「这两个页面是最多人看的，却是唯一没有订阅入口的」。实现时
看了代码才发现前提就不对：这两个页面在第一页**刻意不渲染任何页头** ——
`HomePage.tsx` 和 `FeaturedPage.tsx` 都是
`<PaginatedPageHeader ... hideOnFirstPage showTitle={false} />`，时间线直接从第一条帖子开始。

archive 页和合集页的图标之所以自然，是因为它们本来就有一行元信息（「N 篇 / 最近更新 ⌁」）
可以挂。这两个页面没有那行。加图标等于**在刻意留白的地方凭空造出一块 chrome**，而且是在全站
最安静的两个阅读面上。

而这条计划项要补的那个洞，`/subscribe` 已经补上了：主 feed 和精选 feed 都在那页上列着、带
复制按钮和说明，而且入口在默认导航里。为了一个已经关闭的缺口去破坏这两个页面的留白，不划算。

**已做的：**

- **`/collections` 目录每行的 RSS 图标。** 这是合集 feed 从订阅页拿掉之后**唯一**的交付路径，
  所以它不是可选项。普通合集和智能合集两类行都有 `collection-directory-summary` 元信息行，
  图标挂在那儿，跟 archive / 合集页同一个 `.feed-link` 样式。分组标题没有加 —— 它链向
  `/collections/{a+b}` 聚合页，那个页面自己带图标，分组标题是导航不是合集。
  `feedsEnabled` 从路由的 `appConfig.rssFeedsEnabled` 一路传下来，默认 `false`，所以
  dashboard 的合集管理器（那里的目的是整理不是订阅）不会莫名长出图标。
- **`docs/feeds.md`**，并登记进 `docs/SUMMARY.md`。写的时候查出一处计划外的事实：
  **`?format=` 在 `/feed` 上无效** —— `renderMainFeed` 不传 `format`，只有
  `renderLatestFeed` 调 `parseFormatQuery`。文档按实际行为写。
- **`/settings/general` 的 Feeds 区块链到那篇文档**，用 `getJantDocsUrl("feeds")`。URL 在
  服务端算好、通过 `feeds-docs-url` 属性传给 Lit 组件 —— 客户端组件自己解析不了（AGENTS.md
  明写 Vite 的 `define` 到不了 dev-server 模块）。
- **`/subscribe` 上不放这个链接**：那是 jant.me 的产品文档，对读者答非所问，也等于告诉读者
  这站用的是 Jant。

### 3.5 现有站点怎么换（不用写代码，验证时要走一遍）

`/settings/appearance` →「System links」区（`jant-nav-manager.ts:2874` 的
`#renderSystemToggles`）给 `SYSTEM_NAV_KEYS` 里**每个 key 渲染一行开关**，所以加了
`subscribe` 之后它自己就出现。打开 Subscribe（POST `/api/nav-items`），关掉 RSS（DELETE），
`applySiteHeaderHtml` 当场刷新预览。

三样不会自动继承，都是一次拖拽或一次编辑，可接受：

- **位置**：新项拿 `defaultPlacement: "more"`。作者若把 RSS 拖到过 header，得再拖
- **顺序**：`#handleSystemToggle` 是 `[...this._items, created]` 追加，落在 more 组末尾
  （可能排到 Settings 后面）
- **自定义标签**：改过 "RSS" 的话新项拿 `defaultLabel`，要重改

## 4. 验证（**已完成**）

**自动化**：`vitest run` 全绿 —— 295 个文件 / 3891 个测试。`check-lint`、`check-types`、
`check-copy` 均通过。

注意 `src/db/__tests__/demo-canonical-snapshot.test.ts` 和 `migration-rehearsal.test.ts`
会 shell out 到 wrangler 重建本地 D1，单个耗时约 5 分钟，全量跑时会超时，看起来像失败。
**单跑都通过**，与本次改动无关。

`packages/core/src/client/video-processor.ts` 有 2 个 typecheck 报错，来自 `c8c6e99a`，
本次没碰那个文件 —— **是既有失败，仍未修**。

新增测试：

- `src/client/__tests__/copy-field.test.ts`（7）—— 复制、两条失败路径、点击/聚焦全选、揭开按钮
- `src/routes/pages/__tests__/subscribe.test.ts`（8）—— 三条 feed、两种 `mainRssFeed`
  的配对、archive 描述、无 JS 可用、feeds 关闭时 404、语言视图、slug 不能占用该路径
- `src/routes/pages/__tests__/collections-feed-links.test.ts`（2）—— 目录每行的 feed、
  feeds 关闭时消失
- `src/ui/dash/appearance/__tests__/system-nav-descriptions.test.ts`（3）—— 含那对对照文案
- `lib/__tests__/navigation.test.ts` 和 `jant-nav-manager.test.ts` 各补一条 `subscribe`
  的过滤用例

**浏览器实测**（`mise run dev-debug`，已停止）：

- `/subscribe` 渲染符合设计：一张卡 + 两条低权重项 + 末尾指路。层级读得出来
- 复制按钮工作，toast「Feed URL copied.」
- **两条降级路径在真实浏览器里都验过**：把 `navigator.clipboard` 置为 undefined 后点击
  → 错误 toast「Could not copy. Select the address and copy it.」；点 input → 整条地址被选中
- 窄屏（把容器压到 360px）：卡片和字段收得住，长 URL 在 input 内裁切，页面不横向溢出
- `/settings/navigation` 的 RSS / Subscribe 两行并排、对照可读，**中文已翻译**
- 走了一遍 §3.5 的切换路径：打开 Subscribe、关掉 RSS → 预览当场更新，站点 More 菜单里
  出现 `<a href="/subscribe">`。新项确实落在 more 组末尾、排到了 Settings 后面 ——
  §3.5 里记的那条注意事项属实

**实测查出一个文案 bug，catalog 查不出来**：`{feed}` 插进来的是已翻译的标签，所以中文那句
渲染成「当前是你的 精选。」—— 中文词前多一个空格，而且是英文语序。改成围绕插值写：
「目前返回的是{feed}帖子」（→「目前返回的是精选帖子」/「最新帖子」）。见提交 `c5b4f6a2`。

**留下的本地副作用**：dev 数据库（`Test33`）的导航被我在验证时切成了 Subscribe、关掉了
RSS。是本地 D1，不影响任何真实站点。

## 5. 明确不做

- 给 feed 加 XSLT 样式表。**Chrome 158 将于 2026-11-17 移除 XSLT**（Firefox / WebKit 也表态
  移除），写了就是写一个下季度失效的东西
- `/feed` 上按 `Accept` 头做内容协商（浏览器给 HTML、阅读器给 XML）。阅读器 Accept 头五花八门，
  不少直接发 `*/*`，判错就是静默丢订阅者，代价不对称
- 逐个 feed 的后台显示开关。那个开关会是假的 —— 关掉「显示 archive feed」之后
  `/archive/feed` 照常返回、`/archive` 上的图标照常在、autodiscovery 照常吐，它控制的只是
  另一个页面上的一行字。在设置界面里撒谎比不给开关糟得多
- 订阅数统计（见 §2.8）
- 迁移现有站点的导航（append-only，见 §2.5）

---

## 6. 后续：外观修整 + 阅读器说明（2026-08-30，同日）

作者实测后两条意见：页面丑（没有 RSS 图标、输入框太长）、能不能顺带跟读者讲一下 RSS 阅读器。
不推翻上面任何决定，只补三处。

### 6.1 收窄内容栏到 `max-w-xl`，不动 `CopyField`

`.site-page > main` 的内容区上限就是 `--layout-body-max-width`(1088px)，而
`COPY_FIELD_INPUT_CLASS` 是 `w-full` —— 一条 35 字符的地址躺在 1090px 的框里，
**复制按钮离它要复制的文字约 700px**，三条摞起来读着像设置表单。

修的是**这个页面的栏宽**，不是组件：`CopyField` 在设置页的窄栏里一直长得好好的，改它会
无谓波及设置页。给 `data-page="subscribe"` 加 `max-w-xl` 就够。

注意实际是 **540px 不是 576px** —— 站点根字号 15px，`max-w-xl` = 36rem。540px 够完整显示
带语言前缀的长地址（`https://blog.example.com/zh/archive/feed`）。

标题一起收窄：只收窄字段会让 h1 悬空。

### 6.2 两个 RSS 图标，各有各的活

- **h1 旁边**（走 `PaginatedPageHeader` 已有的 `iconHtml`，`size-6 text-muted-foreground`）：
  给页面一个主题标记。`size-5` 试过，太瘦 —— lucide 的 rss 字形墨迹集中在方框左下约 60%，
  20px 看着只有 13px
- **末尾那句里**（`size-3.5`，`aria-hidden`）：原文写着「Look for **the feed** icon on those
  pages」，指着一个读者在本页从没见过的字形 —— 这是个真的可用性 bug，不只是难看。改成
  「Look for **this** icon」并把字形摆在句子前面。字形跟 `CollectionDirectory` /
  `ArchivePage` 用的是同一个 `getIconSvg("rss")`，指的确实是同一个东西

### 6.3 阅读器说明：只解释，不点名 App

跟作者确认过，否掉了另外两案：

- **写死一份阅读器名单在 core 里** → 每个 Jant 站点都长一样，等于 **Jant 替所有作者背书**
  （读者只会读成「站长推荐」）；且要跟着 App 停运、改名、改定价一起维护；还没法匹配读者的
  平台和地区，一份对一半读者是错的名单比没有更糟
- **作者自填一段** → 要动 settings UI + 两套 schema + i18n，是独立功能，不是这次的修整；
  也会破坏 §2.2 那条「页面完全不碰数据库」

只解释 → 零维护、不会失效、不替谁背书。缺口本来就是「读者不知道这三个地址拿来干嘛」，
解释就补上了。

放**页面最末**、一条 `border-t` 之下、带标题 `What a feed reader does`：已经在用阅读器的人
一眼跳过，不会用的人靠标题扫得到。顺带把下半页的空白填上。

文案守 §2.8 那条硬线（说明书不是邀请函）：

> A feed reader checks these addresses for new posts and collects them in one place. Most are
> an app on your phone or computer; some are a website you sign in to.
>
> Subscribing creates no account here. To stop, delete the address from your reader.

第二句同时答掉「订阅了会不会被看到 / 怎么退订」—— 这是没用过 RSS 的人最常见的顾虑，而且
说的是机制事实。**没写**「不会有人知道你订阅了」这类话：自建站点的日志我们管不着，
承诺不了的别承诺。

### 6.4 验证

- `vitest run`（除掉两个 shell 到 wrangler 的慢用例）：**297 文件 / 3903 用例全绿**
- `tsc --noEmit`：干净。§4 里记的 `video-processor.ts` 那 2 个既有报错**已经不在了**
- `check-copy` 0 error / 0 warning；prettier 已格式化
- `lingui extract --clean`：只动了本次这 4 条（3 新 + 1 改），没误删别的
- 浏览器实测：宽屏（1200px）、窄屏（360px，无横向溢出、图标+文字行悬挂缩进正确）、
  **暗色模式**、复制按钮仍工作（toast「Feed URL copied.」）

新增 2 个用例（`subscribe.test.ts`，共 10 个）：字形出现两次且末句措辞对得上；
说明块在且不含产品名。

**注意**：`mise run check-lint` / `check-tests` / `i18n-build` 这几个走 pnpm 的任务当时在本
worktree 跑不动（`ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`，有个改了 `pnpm-workspace.yaml` 的
合并没做完）。上面这些是绕开 pnpm 直接用 `npx vitest` / `npx tsc` / `npx lingui` 跑的。
