# 写作与内容组织

Jant 的发布模型只有一种东西：帖子。帖子有三种格式（Note、Link、Quote），可以挂附件、可以打分。如果几篇帖子是连着写的，可以串成一个 Thread；如果多个 Thread 讲同一个主题，可以归到一个 Collection。其他都是这两件事的延伸。

## 帖子格式

### Note

主体是你自己的文字时用 Note。日记、随笔、状态、随手记都属于这一类。

标题可选。有标题时，Jant 用它生成 URL slug；没有时，生成一个随机短串。

### Link

分享别人的内容、并附上你的看法时用 Link。例如：朋友写的一篇博客、刚发现的一个好玩工具、值得听的播客单集、读到的一篇好文章。

URL 是必填项；需要自己填标题，可以附上你的评论。

### Quote

引用别人的话时用 Quote。例如：书里看到的一段话、文章里某句让你停下来的话、电影台词等等。

必填项是引文正文；作者、出处链接都可选。引文会以独立样式排版。

## 附件

帖子可以挂附件，附件可以拖动排序。两类：

- **媒体附件**：图片、视频、音频，以及 PDF 等文档。
- **文本附件**：附加的 Markdown 块。适合放与正文不在同一节奏上的内容——例如完整的代码片段、AI 对话原文、长引用。

## 评分

帖子可以带一个 1 到 5 分的可选评分，常用于书、电影、专辑、餐厅这类有明确评价对象的内容。评分会显示在帖子页和列表里。

## 发布设置

发布相关的设置分在两处：

- **Publish settings**（主 **发布** 按钮旁边）：可见性（Public / Hidden from Latest / Private，整条 Thread 共用），以及保存草稿、打开草稿箱。
- **日期与链接**（每条帖子右上角，默认显示 `Now · /…`）：点开可以改这一条的发布时间和链接。鼠标移到帖子上时才显现，手机上一直可见。

### 发布日期（Published on）

帖子默认用当前时间发布。如果你在补录旧内容——从别的平台搬过来的文章、很久以前写下的东西——点开帖子右上角的日期链接按钮，把 **Published on** 改成更早的日期，帖子就会按那个时间排进时间线（首页 Latest 和归档都按发布时间排序）。

留空就用当前时间。只能选今天或更早：Jant 不做定时发布，未来的日期会被拒绝。

### 自定义链接（Custom link）

帖子的 URL 默认由标题生成。同一个按钮里的 **Custom link** 可以在发布前直接指定想要的 slug，例如把 `/my-first-blog-post` 换成干净的 `/hello`。留空则自动生成。

这是发帖时一次把链接定好的最简单方式。注意：**发布后再改这里的链接，旧地址会直接 404**——Jant 不会自动跳转。帖子已经发布、又想换 URL，请改用下面的[自定义 URL](#自定义-url)，它会把旧地址自动 301 跳到新地址。

### 预览草稿

保存帖子后打开**草稿箱**，在对应条目的 **… → 预览** 中打开。Jant 会在新标签页访问 `/preview/{slug}`，并使用与正式页面相同的 Note、Link、Quote、媒体和 Thread 渲染；页面顶部会明确标记当前是草稿预览。

预览地址必须登录后才能访问，也不会被索引或缓存——分享给别人打不开。

## Threads

Thread 是把多条帖子按时间顺序串在一起的结构——你写一条根帖，之后的每一条都「回复」到它下面。

适合那种边想边写、分多次更新的内容：一开始未必想清楚，但希望读者按顺序读完。

整个 Thread 共享根帖的可见性（公开 / 隐藏 / 私密），但 Featured 状态各自独立——某条回复可以单独被 Feature，根帖不需要也是 Featured。

在帖子详情页底部点「回复」即可继续 Thread。

## Collections

Collection 是按 `/{slug}` 组织的策展式分组。同一个 Thread 可以同时属于多个 Collection；Root 与所有回复始终共享同一份归属。

适合：

- 长期跟进的主题（例如某本书的读书笔记）
- 阅读、观影、听歌等清单
- `/now` 之类的站点状态页（参考 [nownownow](https://nownownow.com/) 倡导的「我现在在做什么」页面——也可以理解为长期持续更新的 story）

Collection 有自己的页面和 feed。

URL 里也可以组合多个 Collection：

- `/collections/reading+movies`
- `/collections/notes+links+quotes`

Jant 会把它当成跨多个 Collection 的组合视图：

- 展示这些 Collection 中完整 Thread 的并集
- 同一个 Thread 同时属于多个 Collection 时只显示一次
- 每个命中的 Thread 都会完整展示，包括所有已发布回复
- 同样的写法也适用于 feed：`/collections/{slug1}+{slug2}/feed`

## 创建独立页面（About 页）

Jant 没有单独的「页面」类型——独立页面就是一篇 Hidden from Latest 的帖子。以 About 页为例：

1. 新建一篇 Note，标题写 `About`，正文写你的介绍。
2. 发布状态选 **Hidden from Latest**——页面从首页 Latest 隐去，但直链仍然有效，也不会进默认 `/feed` 打扰订阅者。

发布后页面就在 `/about`——Jant 会用标题生成 slug。想让访客找到入口，到 **设置 → 外观 → 导航** 加一条指向 `/about` 的链接。

## 可见性与策展

### 发布状态

帖子有四种发布状态：

- **`Public`**：公开，出现在首页 Latest，公开访客可见。
- **`Hidden from Latest`**：从首页隐去，但仍然公开——直链有效，所在 Thread 可加入 Collection，也会出现在 `/archive` 里。
- **`Private`**：仅登录后可见。
- **`Draft`**：未发布，仅自己可见。

`/archive` 是站点上所有公开帖子的完整索引。

### Featured

把一条帖子标记为 Featured，等于同时做两件事：在 `/featured` 页面凸显这条帖子，并让它所在的 Thread 进入默认 `/feed`。同一 Thread 即使有多条帖子被标记，也只会在页面和 feed 中出现一次。

- Featured 页面按 Thread 聚合所选帖子，并按最新一条 Featured 帖子的发布时间排列 Thread
- Featured feed 在 `/featured/feed`
- 主 `/feed` 可以指向 Featured 或 Latest，默认指向 Featured

### 为什么默认 feed 是 Featured

Jant 的核心设计之一是把「发布」和「广播」拆开。

**发布**指内容出现在你的站点上——可以通过直链访问，可以加入 Collection，可以继续写成 Thread。

**广播**指内容被推送给订阅者的 RSS feed。

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

把 `MAIN_RSS_FEED` 改成 `latest` 后，默认 `/feed` 的行为会跟着变化，但 `Hidden from Latest` 仍然会让这些帖子留在那条流之外。

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

Jant 动态生成的所有 Atom feeds 都使用同一段发布缓冲时间。新帖子和回复会立即
显示在网页上，但默认五分钟后才可以进入 feed。这给你留出时间检查刚发布的
内容、修正错误，或者在 feed 阅读器抓取前撤回。详见
[配置 § Feed 默认值](configuration.md#feed-默认值可选)。

## 自定义 URL

除了默认的 slug，Jant 还支持给帖子、Collection、归档页设置自定义路径，并支持配置跳转规则。在管理后台进入 **设置 → 高级 → 自定义 URL** 即可统一管理（对应路径是 `/settings/custom-urls`）。

一共有四种类型：

- **Post**：给某篇帖子设置一个新的主要路径，原 slug 自动 301 跳到新路径。
- **Collection**：给某个 Collection 设置一个新的主要路径，原 slug 同样自动 301 跳过去。
- **Archive**：把一组归档筛选条件固化成一个固定路径，例如 `/quotes` 实际渲染 `/archive?format=quote&visibility=public&view=list`。
- **Redirect**：把任意路径跳转到另一个路径，或外部 URL。

### 给帖子或 Collection 设置自定义路径

进入 **设置 → 高级 → 自定义 URL**，点击右上角的 **New Custom URL**：

- **Path**：你希望对外暴露的新路径，例如 `blog/my-post`（不需要写开头的 `/`）
- **Type**：选 `Post` 或 `Collection`
- **Target Slug**：要指向的帖子或 Collection 的 slug

设置之后，新路径成为这条内容对外的主要 URL（permalink、feed、og:url 都使用新路径），原本的 slug 自动 301 跳到新路径——已经传播出去的旧链接不会失效。

适合用来把从其他平台搬过来的内容挂回到原来的链接上。

### 自定义归档视图

如果你经常浏览「某一类」的帖子，可以把对应的归档筛选保存成一个简短可记的入口：

- **Path**：例如 `notes`
- **Type**：选 `Archive`
- **Query Parameters**：归档支持的筛选参数，例如 `format=note&view=list` 或 `format=link&visibility=public`

### 跳转规则

- **Path**：旧路径或外部已经在传播的路径
- **Type**：选 `Redirect`
- **Destination**：目标路径（`/new-path`）或完整外部 URL（`https://...`）
- **Redirect Type**：
  - `301 (Permanent)` —— 用于永久搬迁，搜索引擎会更新索引
  - `302 (Temporary)` —— 用于临时调整，搜索引擎仍记原路径

### 关于直接修改 slug

如果你只是想换一个对外展示的路径，**优先用上面的 Post / Collection 自定义 URL**——原 slug 会自动跳过去，不需要额外操作。

如果你确实要在编辑器里直接改 slug 字段，注意 Jant 不会自动保留旧地址，旧路径会变成 404。这种情况下请同时到 **设置 → 高级 → 自定义 URL** 手动加一条 301，把旧路径指向新 slug。

### 保留路径

下列一级路径是 Jant 自身在用的入口，不能用作自定义 URL：

`featured`、`latest`、`signin`、`signout`、`setup`、`settings`、`dash`、`api`、`feed`、`search`、`archive`、`media`、`pages`、`reset`、`collections`、`compose`、`preview`、`new`、`static`、`assets`、`_assets`、`healthz`、`readyz`

如果旧站点已经有帖子或自定义 URL 直接使用 `/preview`，原记录会保留，但旧链接会变成 404。`/preview` 前缀下已有的自定义 URL 也不再按旧记录解析，因为整个命名空间现在属于登录后的草稿预览。Jant 不会自动生成替代 slug 或 Redirect；需要新公开地址时，请自行修改冲突的帖子或自定义 URL。

自定义路径只能包含小写字母、数字、连字符（`-`）、斜杠（`/`）和点（`.`）。首字符必须是字母或数字。

## 快速入口

登录状态下访问 `/new` 直接进入撰写页面，适合作为浏览器书签。未登录会先跳到登录页，再回到 `/new`。

## 接下来

- [多语言内容](multilingual.md) —— 同时发布多种语言
- [GitHub 同步](github-sync.md) —— 让内容自动同步到 GitHub 仓库
- [主题定制](theming.md) —— 调整站点外观
