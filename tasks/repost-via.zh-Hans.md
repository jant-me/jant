# Repost（via）— Jant 的跨站 Repost

> **状态：暂缓（2026-08-24），未排期。**
>
> 本文是 `repost-via.md` 的中文译本。英文版是实现的准绳（标识符、mf2 类名、UI
> 文案一律以英文版为准），两份文件如有出入以英文版为准。
>
> 暂缓的理由、评审中做出的七项决定（Note 不参与 via、via 行改放 footer meta 行、
> 取消写入时去重、SSRF 复用 `url-fetch.ts`、feed 插入点、放宽 §2 的用词规则、中文
> 术语用 Repost 不译），以及正文里与代码对不上的九处错误，**都完整记在英文版顶部
> 的状态块里**，此处不重复 —— 重开这个任务前先读那一段。
>
> 正文中 §5 的 mf2 标记修正部分（`u-bookmark-of`、`h-cite`、LinkCard 外链上错误的
> `u-url`）已经拆出去单独执行，见
> `tasks/todos/2026-08-24-1709-post-microformats-fixes.md`。

从一次完整的设计讨论（2026-08-07）中提炼出的设计文档，写法上直接面向 AI agent
实现。下面每一条决定都经过权衡；「为什么」的说明存在的意义，是让将来的改动不会
无意间推翻结论，或在不知情的情况下破坏其中的推理。

## 1. 摘要

让 Jant 作者把在别的博客（Jant 或任意 IndieWeb 站点）上看到的帖子转到自己的博客
上，并带上出处。没有联邦化，没有跨站账号，没有社交机制。整个跨站流程可以归结为
一句话：**用 `?via=<url>` 打开你自己的编辑器；你的服务器抓取并预填；你改完发布，
得到一篇普通帖子，只是多带一个 `via_url`。**

两个博客之间从不直接通信。最差情况退化成用户把 URL 粘贴进自己的编辑器 —— 功能照
样成立。

## 2. 术语（已定，不得漂移）

| 层                              | 用词                              | 为什么                                                          |
| ------------------------------- | --------------------------------- | --------------------------------------------------------------- |
| UI 动作（工具栏工具、设置分区） | **Repost**                        | IndieWeb 的规范帖子类型名；标准对齐度最高                       |
| 渲染出的出处行                  | **via b.example**                 | 沿用几十年的博客惯例（致谢）；这是面向读者的文案，不是术语      |
| HTML 标记                       | via 链接上的 **`u-repost-of`** 类 | 互操作唯一在乎的一层；mf2 词汇表是固定的                        |
| 数据库列                        | **`via_url`**                     | 内部命名；准确覆盖了超集（真正的 Repost _和_ 只挂 chip 的致谢） |

「via」不会作为功能名出现在 UI 里。动作叫 Repost；via 只是出处行里的那个
介词。

## 3. 设计红线（产品哲学 —— 这些是底线）

Jant「剥掉了一切社交机制」（Jantelagen）。这个功能能站在这条线的正确一侧，靠的
就是下面这几条约束：

- **公开页面上零入口。** 永远不在公开页面上放 Repost 按钮。这个能力完全属于「要 Repost
  的那个人」（小书签、自己的编辑器）。公开页面只显示那行被动的 via 出处。
- **单向。** 发布一条 Repost 不通知任何人，也不会在来源站点上渲染出任何东西。任何地
  方都没有计数。
- **只拉不推。** 作者能知道的一切（将来的 webmention 统计）都是躺在他主动访问的
  页面上的数据。没有通知，没有未读角标，没有宣告提及的 toast。
- **成本就是过滤器。** Repost 一律走编辑器，并邀请你写点评。这也是 `like` 永久不做
  的原因：一个没有内容的信号，唯一用途是制造认同循环。跨站 `reply` 无限期搁置 ——
  带点评的引用已经用博客原生的形式满足了它。
- **摘录加指针，不是镜像。** 预填只引用摘录，绝不搬全文。媒体一律不搬（见 §12）。

## 4. 数据模型

给 `post` 加一个可空列：

- `via_url` —— text，可空。作者从哪个帖子/页面看到这条内容的 URL。不新增 TypeID，
  不新增表。

要求（仓库硬约束）：

- **同时**更新 `packages/core/src/db/schema.ts`（SQLite/D1）和
  `packages/core/src/db/pg/schema.ts`（Postgres）。
- 两个方向都追加迁移：`src/db/migrations/`（用 `mise run db-schema-generate`）和
  `src/db/migrations/pg/`（用 `mise run db-schema-generate-pg`；如果生成器报告无
  改动，就手写迁移并同步更新 `meta/_journal.json`）。
- 把这个字段贯通到 service 的创建/更新路径、viewmodel、导出、seed/import SQL
  （必须显式声明列名）以及 API schema。在边界上用现成的 URL 校验
  （`src/lib/url.ts` 的 `sanitizeUrl`）清洗；存规范化后的字符串。
- **写入时去重：** 规范化之后，如果 `via_url` 等于该帖子自己的 `url`（Note→Quote
  Repost 的典型情况 —— 引用的来源*就是* via），改存 NULL —— 该格式自己的 `url` 字段
  已经承载了这个指针，Jant 原生的 Quote/Link 语义足够表达，渲染层也就不需要在任
  何地方写比较逻辑（§5）。预填服务（§7）仍然返回 `viaUrl`（编辑器里照样显示
  chip）；丢弃发生在帖子的创建/更新里。由此产生的后果记在 §13：webmention 发送必
  须从帖子引用到的所有 URL 推导目标，不能只看 `via_url`。

明确否决（不要加）：

- **`via_name`** —— 在 IndieWeb 的世界里域名*就是*身份；显示用
  `extractDisplayDomain` 就够；「是谁说的」属于 Quote 格式的 `title`（署名）字段，
  它在 `QuoteCard` 里已经有 `title || extractDisplayDomain(url) || url` 的回退链。
  以后要加一个名字列，只是一次廉价的追加迁移；现在就加则是永久性的表面积（双份
  schema、chip 的编辑 UI、空标签归一化、i18n）。
- 第二个 `repost_of_url` 列 —— 一个字段覆盖超集；Repost 语义交给标记层处理（§5）。

## 5. 渲染

**via 行**出现在三种卡片（`src/ui/feed/` 下的 `NoteCard`、`LinkCard`、
`QuoteCard`）的 feed 和 detail 两种模式里：

- 一行小而安静的出处：`via b.example`，标签取 `extractDisplayDomain(viaUrl)`，
  链接指向 `via_url`，带 `target="_blank" rel="noopener noreferrer"`。
- 这个 a 标签带 **`u-repost-of`** 类，好让 IndieWeb 消费方把这篇帖子解析成 Repost。
  （对只挂 chip 的致谢来说这是一次刻意的轻微「超额声明」—— 可以接受；生态自己就
  把「带点评的 Repost」和 Repost 混着用。精确的致谢词汇 —— 实验性的 `u-via`、Atom 的
  `rel="via"` —— 实际上没有任何消费方，所以我们说那门能被解析的方言。）注意在
  Link Repost 上这两个概念仍然分得清：`u-bookmark-of` 指向被分享的*文章*，
  `u-repost-of` 指向被转的*帖子* —— 标准 mf2 允许一个 h-entry 上同时存在，指向不
  同目标。
- **卡片里不写去重逻辑：** 写入时去重（§4）保证存下来的 `via_url` 必然不等于帖子
  自己的 `url`，所以卡片的规则就是：字段存在则渲染 via 行。（因此 Note→Quote 的
  Repost 会渲染成一篇普通引用帖，没有 `u-repost-of` —— 接受：Jant 自己的 Quote 语义
  已经带着指针，在那里再声明一次「Repost」不增加任何信息。）
- via 的标签是带插值的文案：用 Lingui `msg` 加 `values: { domain }`，并在到达 UI
  之前把空白/空的域名归一化成原始 host。

**Feed：** RSS/Atom 的条目内容带上同样的出处，追加在条目 HTML 末尾：
`<p><a href="{via_url}">via {domain}</a></p>` —— 纯 HTML，两个值都过
`escapeHtml()`。那里不放 mf2 类（feed 阅读器会剥掉 class 属性；这一行是给人看
的）。Feed 阅读器是主要的阅读界面之一 —— 只存在于网页上的出处，等于有一半读者永
远看不到的出处。

**标记完整性（Phase 1 —— 是 §6 里「只用标准词汇做格式识别」的前置条件）：**
Jant 自己的卡片必须用标准 mf2 词汇表达全部三种格式，这样消费方（包括我们自己的
抓取解析器）就永远不需要 Jant 专有的信号：

- `LinkCard`（已批准）：给指向外部目标的链接（现有那个指向 `post.url` 的链接）加
  `u-bookmark-of` 类 —— 这是书签/链接类帖子的标准属性。
- `QuoteCard`：把被引用的内容标成内嵌的 **`h-cite`** —— blockquote 加 `h-cite`，
  引文加 `p-content`，署名链接保留 `u-url` 并给它的标签加上 `p-name`。作者的点评
  （而不是引文）承载 h-entry 的 `e-content`。这些和现有的
  `quoteText`/`url`/`title` 字段一一对应。
- `NoteCard`：已经完整（`e-content`，只有带标题时才有 `p-name`）。

`data-format` 只是给主题用的属性；它永远不作为解析输入。

否决：在引用来源链接后面追加 `#:~:text=` 片段 —— 精确文本匹配脆弱、URL 变长，还
会把 URL 比较（§4 的写入时去重和 h-cite 的 `u-url` 都期待干净的规范 URL）搅浑，
换来的只是一点点跳转体验上的便利。

## 6. 格式映射（转一篇抓取到的帖子）

| 来源格式                  | 新帖子    | 字段映射                                                                                                                                                                                                                                       |
| ------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Note                      | **Quote** | `quoteText` = 笔记正文的纯文本**摘录**（用 `src/lib/excerpt.ts` 的 `getHtmlExcerpt` / 文本提取，绝不用全文）；`title`（署名）= 笔记标题，没有则用来源站点/作者名；`url` = 来源帖子 URL；`via_url` = 来源帖子 URL（随后被 §4 的写入时去重丢弃） |
| Link                      | **Link**  | `url` = 来源帖子指向的那篇*文章*；`title` = 那篇文章的标题；正文**留空**（来源作者的点评是*他们的*话 —— 绝不搬运）；`via_url` = 来源帖子 URL                                                                                                   |
| Quote                     | **Quote** | `quoteText` = 同一段引文；`title`/`url` = 原始出处（谁说的 / 在哪说的）；`via_url` = 来源帖子 URL                                                                                                                                              |
| 任意页面 + `quote` 选区   | **Quote** | `quoteText` = 用户选中的文本（客户端截断，服务端再设上限）；`title` = og/`<title>`/站点名；`url` = 页面 URL；`via_url` = 页面 URL（被 §4 丢弃）。在**任何**页面上都能用 —— 段落是人挑的，不需要解析                                            |
| 解析不了的页面（og 兜底） | **Link**  | `url` = 页面本身；`title` = og/`<title>`；`via_url` = 同一个 URL（被 §4 丢弃）                                                                                                                                                                 |

对抓取到的来源做格式识别**只用标准词汇** —— 不嗅探 Jant 特征，Jant 与非 Jant 来
源走同一条代码路径（前置条件是 §5 的标记完整性，它让 Jant 自己的输出用标准词汇
把上面这些都说清楚）：

1. h-entry 带 `u-bookmark-of` → **Link**（url = 被书签的目标）。
2. h-entry 里含有 `h-cite`（或 `u-quotation-of`）→ **Quote**（复制该 cite 的
   `p-content`/`p-name`/`u-url` —— 注意这样保留的是*原始*出处，比如那本书，而不
   是被转的那篇博客帖子）。
3. 否则走 Post Type Discovery 启发式：没有独立的 name / name ≈ content → note →
   **Quote**；有独立标题 / 文章形态 / 只有 og → **Link**。

因此 Repost 永远不会落到 Note 上：编辑器可以*从* Note 开始（那是默认值），但空编辑器
的抓取一定会按上表切换到 Quote 或 Link。

格式是预填，不是锁死 —— 用户可以在编辑器里切换（比如把一次 Link Repost 改成对来源作
者点评的 Quote，出处引用他们那篇帖子）。

## 7. 抓取服务

**路由：** `GET /api/compose/via?url=<encoded>`，外加来自 §9 的可选 `title` 和
`quote` 透传 —— 需要登录，只是一层薄适配。**Service**（新方法，比如放在
`src/services/post.ts` 或一个小的专用 service）负责全部：抓取、解析、映射、清洗。
返回一个结构化的预填对象 `{ format, title, url, quoteText, viaUrl, sourceDomain }`
（全是已归一化的纯文本）。

解析链：

1. **microformats2**：找到 `h-entry`，读 `p-name`、`e-content`（提取*文本*，丢掉
   标记）、`u-url`、`u-bookmark-of`，以及任何内嵌的 `h-cite`
   （`p-content`/`p-name`/`u-url`）—— 正好是 §6 识别链要消费的那个子集。有了 §5
   的标记完整性，Jant↔Jant 之间的保真度走这同一条标准路径就是精确的。用
   **`microformats-parser`** 解析（社区维护的参考实现；纯 JS 依赖链
   `microformats-parser` → `parse5` → `entities`，在 Workers 和 Node 上都能跑）。
   绝不要手写正则来抽 mf2：属性归属是跟着 DOM 嵌套走的（`h-cite` 里的 `p-name`
   属于那个 cite，不属于 entry）—— 这恰恰是识别链依赖的，也恰恰是正则追踪不了的。
2. **og 元数据 —— 每次抓取都提取，不是只在兜底时提取**：`og:title` /
   `og:site_name` / `<title>`。mf2 落空时它们驱动 Link 预填；mf2 命中时它们回填署
   名（§6 的 note 那一行：标题 = 笔记标题，没有则站点名）。缺失的值就留空 ——
   `QuoteCard` 现有的 `title || domain || url` 链会吸收空值。
3. **失败**：返回一个仍然带着 `viaUrl` 的结果 —— 调用方保留 chip 并显示错误文案
   （§8）。部分成功就是成功。

**调用方给的字段优先。** 入口已经提供的东西（`quote`、`title` —— §9）是权威的：
抓取只填空缺、只提供清洗所需的证据，永远不覆盖。标题优先级：

1. `title` 参数，清洗后；
2. mf2 `p-name` / 抓到的 `og:title`；
3. 抓到的 `<title>`，清洗后；
4. `sourceDomain`。

**标题清洗**是服务端一套共享的归一化，作用于「标题形态」的候选值（`title` 参数和
抓到的 `<title>`；`og:title` 只走前两条高置信度规则）。按证据强度、由高到低：

1. 尾部在分隔符（`|`/`｜`/`-`/`–`/`—`/`·`/`•`/`_`）之后等于抓到的
   `og:site_name` → 精确剥掉这一段；不会误判。
2. 尾部 token 与来源 host 匹配（例如 `bilibili.com` 上的 `…_bilibili`）→ 剥掉。
3. 通用分隔符启发式，保守：只有在剩下 ≥15 字符且被剥掉的尾部 ≤40 字符时才动手。

每一条规则都偏向*不剥*：这是预填进一个作者发布前会过目的可编辑字段 —— 残留一个
「| 知乎」的代价是两次按键，剥过头的标题代价是信任。这一步「过目」也正是我们敢于
清洗调用方传来的标题的理由：编辑器就是那个逐字校对的终审法庭，所以不存在单独的
「原样标题」参数（§9）。

选区短路：当非空的 `quote` 参数与 via URL 一同到达时（小书签捕获的选区、
share_target 里非 URL 的 `text` —— 见 §9 —— 或者从 via URL 本身解析出来的
`#:~:text=` 片段），它优先 —— 按 §6 选区那一行预填 Quote，抓取只用来取标题/站点
元数据。选区在服务端设上限（~2k 字符），并和其他一切一样当作不可信纯文本。

硬性要求：

- **解析必须与运行时无关。** Jant 同时跑在 Workers _和_ Node/Postgres 上。不要用
  `HTMLRewriter`（Workers 独有）；上面的 `microformats-parser` / `parse5` 链是纯
  JS，两个运行时都满足。
- **SSRF 防护**（在 Node 自托管运行时上是真实威胁）：只允许 http/https；超时
  （~5s）；只接受文本类 content-type；最多几跳重定向。**在建连时**校验解析出的
  IP：在 Node 上给 undici agent 传一个自定义 `lookup`，拒绝
  loopback/私有/保留网段。一次解析，与连接共享 —— 这堵住了「先解析→再检查→再抓
  取」这种写法重新打开的 DNS rebinding TOCTOU，而且重定向的每一跳都顺带重新校验，
  因为它们共用同一个 agent。在 Workers 上平台本身就拦截内部 fetch，不需要额外代码。
- **截断，不要失败。** 流式读取 body，读到 ~1 MB 就停，然后解析已读到的部分 ——
  head 里的元数据和正文都靠前，而且 parse5 按 HTML5 错误模型能从截断的 HTML 里恢
  复。永远不要因为体积而拒绝一个响应。
- **抓来的一切都是不可信纯文本。** 进任何 HTML 上下文前先 `escapeHtml()`；绝不把
  抓来的字符串塞进 `dangerouslySetInnerHTML`。

## 8. 编辑器交互

在编辑器工具栏加一个新工具（Lit 组件在
`src/client/components/jant-compose-*.ts`，服务端 UI 在
`src/ui/compose/ComposeDialog.tsx`），沿用现有「工具栏按钮切换字段/面板」的模式。

**工具：** 图标按钮，tooltip **"Repost from URL"**（按文案规范，动词开头）。在
**三种格式下都显示**，包括 Note：抓取路径与格式无关（它自己*会设置*格式，见 §6，
而空编辑器默认就是 Note —— 在那里把按钮藏起来等于藏起了主入口），而且「只挂
chip」这条路径在 Note 上完全成立（经典致谢：「这是我自己的笔记，起因是我在
b.example 看到的东西」）。`via_url` 在设计上与格式正交；按钮不能随着格式切换而出
现或消失。

**面板：** URL 输入框（自动聚焦，placeholder 类似 "Paste a post URL…"）+ Fetch 按
钮。`Enter` 触发，`Escape` 关闭（键盘优先是仓库硬规则；在组件上处理 keydown，不
能只靠 dialog 的 cancel 事件）。面板的空状态带一条安静的常驻链接：
"Get the bookmarklet →"（→ 设置分区，Phase 3；在那之前先链到文档）。

**上下文规则 —— 这是最吃重的一条交互决定。**「空」的定义是：body、title、url、
quoteText 去掉首尾空白后全为空；单是选了某个格式，永远不会让编辑器变成非空。

- **编辑器为空** → 抓取并填充：按 §6 切换格式、填字段、显示 chip。（和 `?via=`
  入口的行为一致。）
- **编辑器里有内容** → **只挂 chip**：附上 `via_url`，不抓取、不切换格式、不碰任
  何字段。这是手动致谢路径（「文章是我自己写的，标一下我从哪看到的」），也是编辑
  已有帖子的路径（那时编辑器按定义就是非空的）。
- 抓取失败收敛到同一个状态：保留 chip，内容不动，按文案规则给一条内联提示 —— 说
  清发生了什么以及下一步怎么办，例如 "Couldn't read that page. The via link is
  saved — write the post yourself."（不指责用户；不要出现「error」。）
- 由此得到：抓取永远不可能毁掉已输入的内容，而且这个工具只有一种失败姿态。

**Chip：** 在编辑器顶部附近显示 `via <domain>`。点击 = 新标签页打开原文；`×`
（以及聚焦时按 `Delete`/`Backspace`）= 移除 `via_url`，内容全部保留。chip 必须可
聚焦。

**发现性：** 除了工具栏按钮本身和面板里那条安静的小书签链接，不做别的。明确否决：
斜杠命令那种定时提示 —— 对一个小众的加分项来说太吵。

所有文案：Lingui `msg` 描述符，带 `@context:` 注释，从本地 i18n context
（`../../i18n/context.js` 的 `useLingui`）取。

## 9. 入口 —— 一切都汇入 `?via=`

`GET /new?via=<url>`（参数名是单个小写单词，符合 URL 规则；这个页面需要登录，所
以可分享 URL 的改名规则并不约束它，但照样遵守）。行为：等同于用户打开 Repost 面板、
粘贴 URL、按下回车 —— 一份实现，N 个触发点：

1. **手动粘贴**进面板（通用底线；也是今天移动端的路径）。
2. **小书签 bookmarklet**（桌面）：已安装的小书签永远无法更新，所以「冻结代码」这
   条规则是：**客户端只笨拙地捕获稳定的原始值；一切判断都留在服务端**，那里还能
   改。捕获的内容（这些 API 稳定了 15 年以上）：
   - `location.href` → `via`；
   - `(document.querySelector('meta[property="og:title"]')||{}).content ||
document.title` → `title` —— 优先用作者写的 og 值而不是渲染出来的标题，这属
     于捕获而不是判断；而且在 SPA、付费墙、反爬墙页面上，页面内的值胜过服务器抓
     取能看到的任何东西；
   - `String(getSelection())` → `quote`。

   解释性的工作 —— 站点后缀剥离、空值归一化、格式映射 —— 全部留在服务端（§7），
   那里的 bug 在安装之后还能修。小书签要以可读源码 + 一个很小的构建步骤来维护，
   由构建产出 `javascript:` URL：真正的规则是「一旦安装就冻结」，不是「必须写成一
   行」。Phase 3 的设置分区提供构建好的、个性化的 URL。

   冻结代码的细节（已充分讨论 —— 这些在安装之后一个都补不了）：
   - **预算算的是编码后的字符数，不是源字符数** —— 一个 CJK 字符编码后要 9 个字
     符，所以按源字符长度设上限毫无意义。按比例缩减直到装得下，且每次截断后都要
     去掉尾部落单的高代理项（`encodeURIComponent` 遇到孤立代理项会*抛错* —— 在冻
     结的小书签里这就是永久性的静默损坏）。预算约 7000 个编码字符总量，其中约
     5500 给 `quote`（约 600 个中文字）—— 在 nginx 和 Apache 默认 8K 请求行上限之
     内。服务端对所有入口另有自己的 ~2k 字符上限（§7）。
   - **用具名的 `window.open` 打开**（重复点击复用同一个编辑器窗口；正在读的页面
     保持原位）；被拦截弹窗时，退回到原地 `location.assign`。必须用 GET：`/new`
     在登录之后，而且只有 GET URL 能挺过登录跳转的往返。

   先选中一段文字 → 在任意页面上都能得到那段文字的 Quote 预填；没有选区 →
   `quote` 为空，被忽略，走正常流程。

3. **PWA `share_target`**（Android；Phase 3）：manifest 里的 `share_target`，
   method GET，action `/new`，分享字段映射到 `url`/`text`/`title` 参数（Android
   经常把分享的 URL 放在 `text` 而不是 `url` 里）。每个参数只有一个含义 ——
   `via`（来源 URL）、`quote`（选区）、`title`（标题提示，§7 的优先级）、
   `url`/`text`（分享载荷）。解析规则：via = `via`/`url`/`text` 中第一个能解析成
   URL 的；title = 有 `title` 就用它；选区 = `quote`，没有则在 via 已从别处取到时
   用非 URL 的 `text`（Android 的「选中文字并分享」把选区放在 `text` 里 —— 于是从
   Android 分享面板做 Quote Repost 白捡）。需要已安装 PWA；iOS 完全不支持
   share_target。
4. **iOS 快捷指令**（只写文档）：一个分享面板快捷指令，打开
   `https://YOUR-BLOG.example/new?via=<分享的 URL>`。

**`title` 参数的语义 —— 一个字段，没有「原样」双胞胎。** `?via=` 是有文档的公开
契约，所以手写的自动化流程可能会传自己的 `title`。它压过所有抓取来的候选（§7），
并且只接受那套「有证据支撑」的清洗 —— 一个刻意写好的标题能挺过那些以来源站点自
己的名字为锚的规则，而万一误伤，编辑器兜得住。明确否决：第二个原样字段
（`doctitle` 之类）。刻意写好的标题本来就能活下来，编辑器是终审法庭，而需要精确
标题的机器发布属于 posts API，不属于一个预填 URL。以后要加一个原样参数是一次廉价
的追加；现在就加则是永久性的表面积（多一个名字要写文档，每个入口都要多做一次选
择）—— 和否决 `via_name`（§4）是同一套逻辑。

## 10. 设置与文档（Phase 3）

- 新增设置分区 **Repost**，沿用集成类分区的模式（`src/ui/dash/settings/`，参考
  `TelegramContent.tsx`），并加上对应的 `SettingsDirectory` 条目。内容：用站点自
  己的 URL 生成的个性化小书签，做成可拖到书签栏的链接（§9 的构建产物 —— 这正是它
  住在设置里而不是静态文档里的原因）+ 复制按钮；iOS 快捷指令步骤；Android
  share-target 说明。
- `docs/` 里一页文档覆盖全部四个入口，用 `https://your-blog.example` 占位符，并指
  向设置页拿生成好的版本。

## 11. 交付阶段

现在承诺 Phase 1–2；Phase 3 等真实使用出现再做；Phase 4 是一个独立的未来项目，只
是把它的*决定*记在这里（§13），免得将来重新吵一遍。Phase 1 和 2 是同一个承诺下的
两个连续执行阶段 —— §14 的完整验证在 Phase 2 落地后跑一次。

- **Phase 1 —— 字段 + 渲染 + 手动致谢（不含抓取代码）：** 两种方言的
  schema/迁移，service/API 贯通并带写入时去重（§4），三种卡片上的 via 行 +
  `u-repost-of`，RSS/Atom 条目内容里的 via 出处，§5 的标记完整性（LinkCard 的
  `u-bookmark-of`、QuoteCard 的 `h-cite`），编辑器的只挂 chip 路径（新帖和已有帖
  都能加/删 via）。它自成一体，单独就有用。
- **Phase 2 —— 抓取与预填：** via service（`microformats-parser` → og → 失败的链
  路，调用方字段优先 + 标题清洗，建连时的 SSRF 防护，截断而不失败的 body 读取，
  运行时中立），`/api/compose/via`，带上下文规则的完整面板交互，`/new` 上的
  `?via=` 入口。作者可以照着文档里的源码自己搭小书签。
- **Phase 3 —— 采用面：** 设置里的 Repost 分区 + 生成的小书签、`share_target` +
  manifest、文档页。
- **Phase 4 —— 不在本文范围：** Webmention + 统计（见 §13）。

## 12. 非目标（已决定，附理由 —— 不要随便重开）

- **不搬运媒体。** 复制不行（最重的镜像行为；版权与礼节；二进制抓取 + 存储 + 清
  理的一整套机制），热链也不行（盗用带宽、对方删了就烂链、泄露读者 IP，而且需要
  在媒体模型里再造一个并行的「远程媒体」概念）。Repost 是摘录 + 指针；读者要看图就
  点进去。看似例外其实不是的一项：Link→Link 的 Repost 会通过*现有的*链接预览流水线在
  目标 URL 上跑出缩略图 —— 零新代码。
- **不做 `like`。** 永久不做。没有内容的认同信号；与产品主张相悖（见 §3「成本就是
  过滤器」）。
- **不做跨站 `reply`。** 无限期搁置；引用 + 点评就是博客原生的回应形式。
- **不做 ActivityPub。** 结构性复杂度（inbox、关注、签名投递）服务的是 Jant 拒绝
  的那套社交模型。IndieWeb 那一套（mf2 + Webmention + 可选 Micropub）才是选定的
  阵营。
- **公开页面上不放 Repost 按钮；不做定时的发现性提示；不做 `via_name`；不做任何形式
  的通知。**

## 13. 未来轨道（只记录决定，不排期）：Webmention 与统计

记在这里，是为了让将来的统计项目继承结论，而不是继承争论：

- **没有 Webmention，Repost 照样成立。** Phase 1–3 一点都不实现。
- 将来真做统计页时：只出聚合值，最小粒度到天，从有界的计数表算出来
  （`waitUntil` 里 `INSERT … ON CONFLICT count+1`），绝不写逐事件日志。内容：浏览
  趋势、热门帖子、来源*域名*（Top-N 上限 + 「其他」；排除自己登录后的访问和明显
  的机器人）、按 UA 统计的 feed 订阅者数。不做 UV（那需要标识访客）。用普通的双方
  言表 —— 不依赖 CF Analytics（Node 自托管必须表现一致）。
- 来源域名已经免费回答了「有多少流量来自 b.example」。只有当真的需要帖子级别的精
  度（「他们的帖子 X 链接了我的帖子 Y」）时，才去实现**标准的 Webmention 接收**
  （绝不做 Jant 私有的 ping）。
- 接收端设计：按规范抓取 source 做验证（规范强制）—— 这杀死了伪造的 ping；异步队
  列 + 限流 + 与 §7 相同的 SSRF 防护；可选地只统计能解析成 `h-entry` 的来源。垃圾
  信息的经济账本来就已经被拆掉了，因为提及**只进私有统计，永不公开渲染**
  （trackback 当年的死亡螺旋来自公开展示 + SEO 奖励）。
- 提及的存储：`(source_url, target_post_id, kind, first_seen, last_seen,
source_title)`，(source, target) 唯一，重复 ping 时 upsert。`kind` 由 mf2 推导
  （`u-repost-of` → repost，`in-reply-to` → reply，其余 → mention）。**全量保留**
  （量本来就是涓流，而且这是这个博客的关系图谱）；「最近」是*展示*窗口，不是保留
  策略。首选的呈现面是帖子详情页上仅作者可见的「Mentioned by」列表（沿用
  trackback 的传统：回应挂在帖子上，不是挂在一个中心化的信息流里）。
- 删除：按规范 —— 重新 ping 时来源已不再链接（或返回 410）就**硬删除**该行。不留
  墓碑（尊重撤回：这条记录派生自他们的内容）。删除不通知任何人。聚合数字是读的时
  候从表里算出来的，所以删除不需要任何额外记账。不为死站点跑后台重爬；每行一个手
  动隐藏 / 屏蔽域名的按钮就能覆盖烂链和残余垃圾。
- 发送（便宜的「好公民」那一半，随时可以捎带上）：**按规范行事，不为 Jant 开特
  例** —— 发布时收集帖子引用到的每一个外部 URL（`url`、`via_url`、正文里的链
  接），去重，逐个发现目标的 webmention endpoint，向有 endpoint 的目标 POST
  source+target。endpoint 发现本身*就是*过滤器：不参与的站点什么都收不到。（只盯
  着 `via_url` 会漏掉 Note→Quote Repost，因为它们的 via 在写入时被丢掉了，§4。）
  **编辑/删除时，向新旧目标的并集重发**，好让对方能清理掉被移除的链接 —— 这就要
  求记住发过什么：一张很小的「每帖已发送目标」表（目标 URL、最后发送时间），每次
  发送 upsert。在 `waitUntil` 里异步执行，SSRF 防护与 §7 相同。

## 14. 验证计划

行为改动 ⇒ `mise run check-tests` + `mise run check-lint`（仓库规则），外加针对性
测试：

- Schema：两种方言在全新数据库上都能干净迁移；seed/import SQL 仍然通过校验。
- Service：写入时去重（创建/更新在规范化后丢弃等于 `url` 的 `via_url`）；via 抓取
  —— 按格式映射逐行验证 mf2 正常路径、og 兜底、mf2 命中时的 og 署名回填、标题优先
  级（`title` 参数压过抓取来的候选）、标题清洗（站点名后缀剥离、host token 剥离、
  保守的通用规则；刻意写好的标题不被动）、失败仍保留 via、1 MB 截断后仍能解析、
  SSRF 拒绝（建连时的 loopback/私有 IP、重定向跳转、非文本）、恶意抓取字符串的转
  义。
- 渲染：`via_url` 有值时才出现 via 行、`u-repost-of` 存在、
  `rel="noopener noreferrer"`、LinkCard 上的 `u-bookmark-of`、QuoteCard 的
  `h-cite`/`p-content` 结构、RSS/Atom 条目内容末尾追加的 via 出处。
- 编辑器：上下文规则（空 → 填充；非空 → 只挂 chip，字段不动）、移除 chip 后内容还
  在、Escape/Enter/焦点处理、编辑模式下的致谢。
- 路由：`?via=` 的解析（URL 候选顺序、share_target 落地后的 `quote`/非 URL
  `text` 选区规则、`title` 透传）、`/new` 仍然要求登录。
- 手工：dev 登录流程（`mise run dev-debug`），针对第二个本地 Jant 站点创建每一种
  Repost 形态，检查卡片和 feed。

## 15. 状态

- [ ] Phase 1 —— `via_url` + 渲染 + 只挂 chip 的致谢
- [ ] Phase 2 —— 抓取服务 + `?via=` + 完整面板
- [ ] Phase 3 —— 设置/小书签/share_target/文档
- [ ] Phase 4 —— 未排期（决定见 §13）
