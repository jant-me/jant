# 写作与内容组织

Jant 的发布模型只有一个基本单位：帖子。帖子分三种格式（Note、Link、Quote），可以挂附件，也可以打分。连着写的几条帖子能串成一个 Thread，讲同一个主题的多个 Thread 能归进一个 Collection。其余都是这两层结构的延伸。

## 帖子格式

### Note

正文是你自己写的文字时用 Note。日记、随笔、状态、随手记都属于这一类。

标题可选。有标题时 Jant 用它生成 URL slug，没有就生成一个随机短串。

### Link

分享别人的内容、附上自己的看法时用 Link。例如：朋友写的一篇博客、刚发现的好玩工具、值得听的播客单集、读到的一篇好文章。

URL 和标题必填，评论可选。

### Quote

引用别人的话时用 Quote。例如：书里的一段话、文章里让你停下来的某一句、电影台词。

引文正文必填，作者和出处链接可选。引文会用独立的样式排版。

## 附件

帖子可以挂附件，也可以拖动调整顺序。分两类：

- **媒体附件**：图片、视频、音频，以及 PDF 等文档。
- **文本附件**：附加的 Markdown 块。适合放不该混进正文的内容——完整的代码片段、AI 对话原文、长引用。

## 评分

帖子可以打 1 到 5 分。适合书、电影、专辑、餐厅这类有明确评价对象的内容。评分显示在帖子页和列表里。

## 发布设置

发布相关的设置分在两处：

- **Publish settings**（主 **Publish** 按钮旁边）：可见性（Public / Hidden from Latest / Private，整条 Thread 共用），以及 **Save as draft** 和 **Drafts**。
- **日期与链接**（每条帖子右上角，默认显示 `Now · /…`）：点开可以改这一条的发布时间和链接。鼠标移到帖子上时出现，窄屏上一直可见。

### 发布日期（Published on）

帖子默认用当前时间发布。补录旧内容时——从别的平台搬过来的文章、很久以前写下的东西——点开右上角的**日期与链接**，把 **Published on** 改成更早的日期，帖子就会按那个时间排进时间线。首页 Latest 和归档都按发布时间排序。

留空就用当前时间。只能选今天或更早：Jant 不做定时发布，未来的日期会被拒绝。

### 自定义链接（Custom link）

帖子的 URL 默认由标题生成。**日期与链接**里的 **Custom link** 可以在发布前指定 slug，例如把 `/my-first-blog-post` 换成 `/hello`。留空则自动生成。

这里只适合发布前定好链接。**发布后再改这里，旧地址会直接 404**——Jant 不会自动跳转。帖子已经发布又想换 URL，改用下面的[自定义 URL](#自定义-url)，它会把旧地址自动 301 跳到新地址。

### 预览草稿

保存帖子后打开 **Drafts**，在对应条目上选 **… → Preview**。Jant 会在新标签页打开 `/preview/{slug}`，Note、Link、Quote、媒体和 Thread 的渲染与正式页面完全一致，页面顶部标明这是草稿预览。

预览地址必须登录后才能访问，也不会被索引或缓存。

## Threads

Thread 把多条帖子按时间顺序串在一起：先写一条根帖，之后每一条都用 **Reply** 挂在它下面。

适合边想边写、分多次更新的内容：一开始未必想清楚，但希望读者按顺序读完。

整个 Thread 共享根帖的可见性（Public / Hidden from Latest / Private），但 Featured 状态各自独立：某条 Reply 可以单独标成 Featured，根帖不必跟着标。

在帖子详情页底部点 **Reply**，就能接着往下写。

## Collections

Collection 是一组你自己策展的内容，地址是 `/{slug}`。同一个 Thread 可以同时属于多个 Collection，根帖和它的所有 Reply 始终属于同一批 Collection。

适合：

- 长期跟进的主题（例如某本书的读书笔记）
- 阅读、观影、听歌等清单
- `/now` 之类的站点状态页（[nownownow](https://nownownow.com/) 提倡的「我现在在做什么」，相当于一个长期慢慢更新的 story）

Collection 有自己的页面和 feed。

URL 里也可以组合多个 Collection：

- `/collections/reading+movies`
- `/collections/notes+links+quotes`

这是一个跨多个 Collection 的组合视图：

- 取这几个 Collection 里 Thread 的并集
- 同一个 Thread 属于其中多个 Collection 时只出现一次
- 命中的 Thread 完整展示，包含所有已发布的 Reply
- feed 同样支持：`/collections/{slug1}+{slug2}/feed`

## 创建独立页面（About 页）

Jant 没有单独的「页面」类型——独立页面就是一篇 Hidden from Latest 的帖子。以 About 页为例：

1. 新建一篇 Note，标题写 `About`，正文写你的介绍。
2. 发布状态选 **Hidden from Latest**：页面从首页 Latest 隐去，但直链仍然有效，也不进默认 `/feed`。

发布后页面就在 `/about`，slug 由标题生成。想让访客找到入口，到 **设置 → 外观 → 导航栏** 加一条指向 `/about` 的链接。

## 可见性与策展

### 发布状态

帖子有四种发布状态：

- **`Public`**：出现在首页 Latest，未登录的访客也能看到。
- **`Hidden from Latest`**：从首页隐去，但内容仍然公开——直链有效，所在 Thread 可加入 Collection，也会出现在 `/archive` 里。
- **`Private`**：仅登录后可见。
- **`Draft`**：未发布，仅自己可见。

`/archive` 是站点上所有公开帖子的完整索引。

### Featured

把一条帖子标成 Featured 会做两件事：这条帖子出现在 `/featured` 页面，它所在的 Thread 进入默认 `/feed`。同一个 Thread 即使标了多条，页面和 feed 里也只出现一次。

- Featured 页面按 Thread 归拢选中的帖子，Thread 之间按其中最新一条 Featured 帖子的发布时间排序
- Featured feed 在 `/featured/feed`
- 主 `/feed` 可以指向 Featured 或 Latest，默认指向 Featured

### 为什么默认 feed 是 Featured

Jant 的核心设计之一是把「发布」和「广播」拆开。

**发布**指内容出现在你的站点上——可以通过直链访问，可以加入 Collection，可以继续写成 Thread。

**广播**指内容进入订阅者的 RSS feed。

这两件事在 Jant 里是独立的：

- 标记为 `Hidden from Latest` 的帖子会从首页隐去，但内容本身仍然公开：直链有效，所在 Thread 可加入 Collection，也会出现在 `/archive` 里。
- `Public` 的帖子会出现在首页 Latest，但**不会**进入默认的 `/feed`。
- 只有标记为 `Featured` 的内容，才会进入 `/feed`，推送给订阅者。

所以细碎的记录可以照发：它们出现在站点上，但不打扰订阅者。只有你认为值得分发的内容才进入 feed。

### 默认行为一览

下表假设默认配置 `MAIN_RSS_FEED=featured`。

| 帖子状态             | 直链可访问   | Latest | `/archive`   | 默认 `/feed` | Collection   |
| -------------------- | ------------ | ------ | ------------ | ------------ | ------------ |
| `Public` 且 Featured | 是           | 是     | 是           | 是           | 是           |
| `Public`             | 是           | 是     | 是           | 否           | 是           |
| `Hidden from Latest` | 是           | 否     | 是           | 否           | 是           |
| `Private`            | 仅登录后可见 | 否     | 仅登录后可见 | 否           | 仅登录后可见 |
| `Draft`              | 否           | 否     | 否           | 否           | 否           |

把 `MAIN_RSS_FEED` 改成 `latest` 后，默认 `/feed` 的内容跟着变，但 `Hidden from Latest` 的帖子仍然不会进入。

## URL 与浏览页面

Jant 使用可读 URL：

- 帖子：`/{slug}`
- Collection：`/{slug}`
- 组合 Collection 视图：`/collections/{slug1}+{slug2}+{slug3}`
- 搜索：`/search`
- 归档：`/archive`
- Featured 页面：`/featured`

Feed：

- `/feed` 使用你当前配置的主 feed
- `/latest/feed` 返回出现在首页 Latest 的帖子（不含 `Hidden from Latest`）
- `/featured/feed` 中，每个包含 Featured 帖子的 Thread 只返回一个条目
- `/archive/feed` 返回全量公开帖子（包含 `Hidden from Latest`），支持 `?year=`、`?format=`、`?collection=`、`?media=` 等筛选参数
- `/{slug}/feed` 返回单个 Collection 的 feed
- `/collections/{slug1}+{slug2}/feed` 返回组合 Collection 的 feed

每个页面都会在 HTML head 里声明 feed，阅读器和浏览器插件不用你手动给地址也能嗅探到。Collection 页和归档页把自己的 feed 排在最前，并带上当前筛选条件，所以在某个页面上订阅，拿到的就是这个页面显示的内容。

Jant 动态生成的 Atom feed 都有同一段发布缓冲：新帖子和 Reply 立即显示在网页上，默认五分钟后才进入 feed。这段时间可以用来检查刚发布的内容、改错，或者赶在 feed 阅读器抓取前撤回。详见[配置 § Feed 默认值](configuration.md#feed-默认值可选)。

## 自定义 URL

除了默认 slug，帖子、Collection、归档页都可以设置自定义路径，也可以配置跳转规则。这些都在 **设置 → 高级 → 自定义 URL** 里管理（路径 `/settings/custom-urls`）。

一共有四种类型：

- **帖子**：给某篇帖子换一个新的主要路径，原 slug 自动 301 跳到新路径。
- **合集**：给某个 Collection 换一个新的主要路径，原 slug 同样自动 301 跳过去。
- **归档**：把一组归档筛选条件固定成一个路径，例如 `/quotes` 实际渲染 `/archive?format=quote&visibility=public&view=list`。
- **重定向**：把任意路径跳到另一个路径或外部 URL。

### 给帖子或 Collection 设置自定义路径

进入 **设置 → 高级 → 自定义 URL**，点右上角的**新建自定义 URL**：

- **路径**：你希望对外暴露的新路径，例如 `blog/my-post`（不用写开头的 `/`）
- **类型**：选「帖子」或「合集」
- **目标 slug**：要指向的帖子或 Collection 的 slug

保存后，新路径成为这条内容对外的主要 URL（permalink、feed、og:url 都用新路径），原 slug 自动 301 跳过去，已经传播出去的旧链接不会失效。

适合把从其他平台搬过来的内容挂回原来的链接。

### 自定义归档视图

经常按某一类筛选帖子时，可以把这组归档筛选存成一个好记的短路径：

- **路径**：例如 `notes`
- **类型**：选「归档」
- **查询参数**：归档支持的筛选参数，例如 `format=note&view=list` 或 `format=link&visibility=public`

### 跳转规则

- **路径**：已经传播出去的旧路径
- **类型**：选「重定向」
- **目标地址**：目标路径（`/new-path`）或完整的外部 URL（`https://...`）
- **重定向类型**：
  - `301`（永久）—— 不打算改回的搬迁，搜索引擎会更新索引
  - `302`（临时）—— 短期调整，搜索引擎仍记原路径

### 关于直接修改 slug

如果你只是想换一个对外展示的路径，**优先用上面的自定义 URL（类型选「帖子」或「合集」）**——原 slug 会自动跳过去，不用额外操作。

确实要在编辑器里直接改 slug 字段的话，注意 Jant 不会保留旧地址，旧路径会变成 404。这时要自己到 **设置 → 高级 → 自定义 URL** 加一条 301，把旧路径指向新 slug。

### 保留路径

下列一级路径是 Jant 自身在用的入口，不能用作自定义 URL：

`featured`、`latest`、`signin`、`signout`、`setup`、`settings`、`dash`、`api`、`feed`、`search`、`archive`、`media`、`pages`、`reset`、`collections`、`compose`、`preview`、`new`、`static`、`assets`、`_assets`、`healthz`、`readyz`

如果旧站点已经有帖子或自定义 URL 直接使用 `/preview`，原记录会保留，但旧链接会变成 404。`/preview` 前缀下已有的自定义 URL 也不再按旧记录解析，因为整个命名空间现在属于登录后的草稿预览。Jant 不会自动生成替代 slug 或跳转，需要新的公开地址就自己改掉冲突的帖子或自定义 URL。

自定义路径只能包含小写字母、数字、连字符（`-`）、斜杠（`/`）和点（`.`）。首字符必须是字母或数字。

## 快速入口

登录状态下访问 `/new` 直接进入撰写页面，适合存成浏览器书签。未登录会先跳到登录页，登录后回到 `/new`。

## 接下来

- [多语言内容](multilingual.md) —— 同时发布多种语言
- [GitHub 同步](github-sync.md) —— 让内容自动同步到 GitHub 仓库
- [主题定制](theming.md) —— 调整站点外观
