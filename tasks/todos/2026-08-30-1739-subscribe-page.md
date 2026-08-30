# 订阅页 `/subscribe`

日期：2026-08-30
状态：**进行中**（commit 1 / 5 完成）

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

分 5 个 commit，按顺序。每个 commit 自身可用、可验证。

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

### 3.3 commit 3 — 导航新增 `subscribe` 系统项

- `SYSTEM_NAV_KEY_VALUES` 追加 `"subscribe"`（`types/constants.ts:118`）
- `SYSTEM_NAV_KEYS` 追加
  `subscribe: { defaultLabel: "Subscribe", url: "/subscribe", defaultPlacement: "more" }`
- `DEFAULT_NAVIGATION_PROFILES` 追加 v3 = v2 把 `rss` 换成 `subscribe`，
  `DEFAULT_NAVIGATION_PROFILE_VERSION = 3`。**v1/v2 一个字不改**
- `BUILTIN_NAV_LABELS`（`navigation-labels.ts:22`）和 `SYSTEM_NAV_DESCRIPTIONS`（`:85`）各补一项

**两处 `rssFeedsEnabled` 过滤必须同时覆盖新 key**，漏了的话 feeds 关掉后导航会留一个
Subscribe、点进去是列着三条失效地址的页面：

- `lib/navigation.ts:120`（服务端渲染投影）
- `jant-nav-manager.ts:1335`（`#isVisibleInPreview`，设置页预览）

两处现在都写死 `systemKey !== "rss"`。

**双方言 schema 要改，但不用迁移**：`SYSTEM_NAV_KEY_VALUES` 是 `nav_item.system_key` 的列
枚举（`db/schema.ts:819`、`db/pg/schema.ts:810`），两边都要加 —— 但两边都是
`text(..., { enum })`，Drizzle 只在 TypeScript 层收紧，不生成 CHECK、不是 `pgEnum`，所以
**两个 migrations 目录都不动**。`lib/schemas.ts:174` 的 `SystemNavKeySchema` 由同一个常量
派生，自动跟上。

### 3.4 commit 4 — 两行对照文案（这不是附带项）

机制上换过去只要翻两个开关（§3.5），但**能不能称为「容易」全看这两行说明**。作者会看到两个
长得差不多的开关，得一眼知道选哪个。

`NavigationContent.tsx:262` 现在特判了 `key === "rss"` 的描述，那段文案在新语境下会变成误导，
改掉。（顺带：这个特判把 `SYSTEM_NAV_DESCRIPTIONS.rss`（`navigation-labels.ts:94`）在这条
路径上整个覆盖掉了 —— 同一个改动里清掉这份重复。）

两行写成**一对对照**：

> **RSS** — Links straight to /feed — the raw Atom file, currently your {feed} feed.
> Best for readers who already use a feed reader.
>
> **Subscribe** — Links to /subscribe, a page listing your feeds with copy buttons.
> Best for readers who don't already use one.

中文（全角标点、无主语、不用「您」）：

> **RSS** —— 直接指向 /feed，即 Atom 原文件，当前是你的{feed}。适合已经在用阅读器的读者。
>
> **Subscribe** —— 指向 /subscribe，一个列出你所有 feed 地址、带复制按钮的页面。
> 适合还没在用阅读器的读者。

`{feed}` 插值（显示「你的 Latest feed」还是「Featured feed」）保留在 RSS 行上，确实有用。

**不要加互斥。** 两个都打开有点傻但不算坏，而隐藏的互斥规则会让作者困惑（「我怎么打不开
另一个」）。靠文案说清就够。

三个 locale（`i18n/locales/public/`、`settings/`，各 en / zh-Hans / zh-Hant）都要有。
zh-Hant 按台湾惯用词，不是简繁转换。

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

### 3.6 commit 5 — 就近入口补齐与文档

**`/` 和 `/featured` 补 RSS 图标** —— 照 `ArchivePage.tsx:1391` 的 `feed-link` 同款，指向
`/feed` 与 `/featured/feed`，`rssFeedsEnabled` 关时不渲染。这两个页面是最多人看的，却是唯一
没有订阅入口的。

**`/collections` 目录页每行补 RSS 图标** —— 合集 feed 从订阅页拿掉后，这是它唯一的交付路径。
注意 `CollectionDirectory.tsx` 有**四处**链接站点、三类实体：分组（`:172`）、普通合集
（`:219`、`:386`）、智能合集（`:301`）。四处都要，别只改一处。

**新建 `docs/feeds.md`** —— 把页面上刻意不写的都放这：完整 feed 路由表、`{page}/feed` 规则、
`/collections/{a+b}/feed` 聚合地址、`?format=`（只在 latest 系有效）、archive 的
`?sort=updated`、`rssFeedLimit` 截断、`rssPublishDelaySeconds` 延迟、多语言前缀下的行为、
`/feed/latest` 等 308 老地址。写完跑 `mise run check-copy`。

**从 `/settings/general` 的 Feeds 区块链过去**，用 `getJantDocsUrl()`（`lib/jant-docs.ts`），
不要手写 URL。

**不要从 `/subscribe` 链出去** —— 那是 jant.me 的产品文档：对读者答非所问，且等于告诉读者
「这站用的是 Jant」。作者面链产品文档才对。

`/collections` 目录页本身**没有** feed（`isCollectionSelectionSurface` 只放行
`/collections/{selection}` 和它的 feed），文案别写得像有。

---

## 4. 验证

按 AGENTS.md「按比例验证」，这次涉及路由、导航服务、双方言 schema 常量、客户端交互逻辑，
属于「行为改动」，**`mise run check-tests` 和 `mise run check-lint` 都要跑**，文档和文案部分
另跑 `mise run check-copy`。

要新写的测试：

- `/subscribe` 在 `rssFeedsEnabled` 开/关下的 200 / 404
- `/{lang}/subscribe` 存在，且页面上给的是**带语言前缀的绝对地址**
- 三条地址在 `mainRssFeed` 为 latest / featured 两种配置下都正确，且主 feed 那条的说明随之变
- `subscribe` 在 `RESERVED_PATHS` 里 —— 建同名 slug 的 post/collection 被拒
- feeds 关掉时，`subscribe` 系统导航项在**服务端投影和客户端预览两处**都不出现
- `/`、`/featured`、`/collections` 上 RSS 图标的存在与 `rssFeedsEnabled` 关时的消失

手动走一遍（`mise run dev-debug`）：

- §3.5 那条路径：在一个 profile v2 的既有站点上翻两个开关，确认导航换过去、预览当场更新
- 复制按钮：HTTPS 下能复制；**故意在 http 端口下点一次**，确认 input 全选降级还在、错误
  toast 出来
- 移动端宽度下卡片和长 URL 不撑破布局

---

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
