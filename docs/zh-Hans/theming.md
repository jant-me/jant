# 主题定制

Jant 提供三种自定义外观的方式，按粒度从粗到细：

1. 内建颜色主题
2. 内建字型主题
3. 自定义 CSS

先从 **Settings > Color Theme** 和 **Settings > Font Theme** 开始；这些不够用时，再去 **Settings > Custom CSS** 写覆盖。

所有内建主题都同时包含浅色和深色配色。Custom CSS 叠加在所选主题之上——把内建主题当起点，不必从零重写。

## 颜色变量

颜色变量分两层：

- **核心色盘**（`--primary`、`--background` 等）控制整体观感，改一个会影响整站。
- **站点专用颜色**（`--site-*`）默认从核心色盘派生，让你在不动整体配色的情况下精调局部，比如只改链接颜色而不改按钮颜色。

大多数颜色变量成对出现：一个背景色，加上对应的前景色（文本颜色）。

### 核心色盘

| 变量                     | 作用                               |
| ------------------------ | ---------------------------------- |
| `--background`           | 页面背景                           |
| `--foreground`           | 主文本颜色                         |
| `--primary`              | 功能性主色（按钮、选中态 UI）      |
| `--primary-foreground`   | 主色元素上的文本颜色               |
| `--secondary`            | 次级按钮、徽章                     |
| `--secondary-foreground` | 次级元素上的文本颜色               |
| `--muted`                | 细微背景（hover 状态、徽章）       |
| `--muted-foreground`     | 次级文本（日期、说明、占位符）     |
| `--accent`               | hover / focus 背景（菜单、导航项） |
| `--accent-foreground`    | accent 背景上的文本颜色            |
| `--card`                 | 卡片背景                           |
| `--card-foreground`      | 卡片内文本颜色                     |
| `--popover`              | 下拉菜单 / 浮层背景                |
| `--popover-foreground`   | 浮层内文本颜色                     |
| `--destructive`          | 危险操作（删除按钮、错误提示）     |
| `--success`              | 成功状态提示                       |
| `--border`               | 边框和分隔线                       |
| `--input`                | 输入框边框                         |
| `--ring`                 | 焦点环颜色                         |

### 站点专用颜色

这些变量默认从核心色盘派生。内建主题会单独设置 `--site-accent`；如果你只手动覆盖核心色盘，`--site-accent` 会回退到 `--primary`。

| 变量                            | 默认值                          | 作用                                                                   |
| ------------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `--site-accent`                 | `var(--primary)`                | 阅读区强调色：引号、Thread 连接点、链接卡片的底色、hover 和焦点环      |
| `--site-page-bg`                | `var(--background)`             | 页面背景，以及放在页面上的区块                                         |
| `--site-subtle-bg`              | `var(--accent)`                 | 导航 hover、信息流里的卡片和代码块的浅底色                             |
| `--site-text-primary`           | `var(--foreground)`             | 主文本                                                                 |
| `--site-text-secondary`         | `var(--muted-foreground)`       | 次级 / 说明文本                                                        |
| `--site-divider`                | `var(--border)`                 | 内容分隔线                                                             |
| `--site-threadline`             | `var(--border)`                 | Thread 连线                                                            |
| `--site-reading-body`           | 由 `--site-text-primary` 派生   | 帖子详情页的正文。内建主题会设置它，所以只改 `--foreground` 管不到正文 |
| `--site-reading-caption`        | 由文字颜色派生                  | 帖子详情页的图注和脚注                                                 |
| `--site-content-link`           | `inherit`                       | 帖子里的链接文字                                                       |
| `--site-content-link-hover`     | `var(--site-text-primary)`      | 链接 hover 时的文字                                                    |
| `--site-content-link-underline` | 由 `--site-text-secondary` 派生 | 链接下划线                                                             |
| `--site-footnote-text`          | `var(--site-reading-caption)`   | 宽屏侧栏里的脚注文字                                                   |
| `--site-footnote-marker`        | 由 `--site-text-secondary` 派生 | 侧栏里的脚注编号                                                       |
| `--site-search-mark-bg`         | 内置黄底                        | 搜索结果高亮背景                                                       |
| `--site-search-mark-color`      | 内置深字                        | 搜索结果高亮文字                                                       |

### 示例：自定义主色和站点强调色

```css
:root {
  --primary: oklch(0.48 0.08 255);
  --primary-foreground: oklch(0.98 0 0);
  --site-accent: oklch(0.56 0.06 240);
}

:root[data-theme-mode="dark"] {
  --primary: oklch(0.79 0.06 255);
  --primary-foreground: oklch(0.19 0.01 255);
  --site-accent: oklch(0.74 0.07 240);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme-mode="light"]) {
    --primary: oklch(0.79 0.06 255);
    --primary-foreground: oklch(0.19 0.01 255);
    --site-accent: oklch(0.74 0.07 240);
  }
}
```

两条深色规则的写法见[深色模式](#深色模式)。

### 示例：让 Thread 连线带颜色

```css
:root {
  --site-threadline: oklch(0.8 0.05 250);
}
```

## 排版变量

| 变量                  | 默认值                  | 作用                                         |
| --------------------- | ----------------------- | -------------------------------------------- |
| `--font-body`         | 系统 sans-serif         | 正文、输入框                                 |
| `--font-heading`      | 偏编辑风格的 serif 组合 | 帖子标题、h1–h3                              |
| `--font-site-title`   | 偏编辑风格的 serif 组合 | 站点 logo（标题栏）                          |
| `--font-ui`           | 系统 sans-serif         | 按钮、导航、标签、徽章（不受字型主题影响）   |
| `--font-serif`        | 系统 serif + Noto 回退  | serif 强调文本                               |
| `--font-blockquote`   | `inherit`               | 引用块字族，默认跟随正文字体                 |
| `--font-mono`         | 系统 monospace          | 代码块                                       |
| `--type-body-size`    | 正文字号                | 帖子正文的字号；脚注引用和代码的字号按它换算 |
| `--type-footnote-ref` | 正文字号的 `75%`        | 行内脚注引用的字号                           |
| `--fw-regular`        | 400                     | 正文                                         |
| `--fw-medium`         | 500                     | 标签、激活导航                               |
| `--fw-semibold`       | 600                     | 标题、按钮                                   |

在 **Settings > Font Theme** 选字型主题后，`--font-heading`、`--font-body` 以及若干相关字重会随之切换。`--font-ui` 不在切换范围内——按钮、导航这些界面文字始终用系统 sans-serif，方便阅读。要进一步调整，仍然可以在 Custom CSS 里覆盖任意变量。

如果想用 Google Fonts 这类外部字体源，需要先用 [代码注入](code-injection.md#配方自定义字体) 加载字体文件，再在 Custom CSS 里把变量指向新字体。

### 示例：更细的字重

```css
:root {
  --fw-medium: 400;
  --fw-semibold: 500;
}
```

## 布局变量

| 变量                      | 默认值   | 作用                                       |
| ------------------------- | -------- | ------------------------------------------ |
| `--layout-body-max-width` | `1088px` | 页面框架（页头、内容、页脚）的最大宽度     |
| `--site-feed-rhythm`      | `4.4rem` | 列表里帖子之间的间距，以及第一篇之上的间距 |
| `--layout-sidenote-width` | `50%`    | 宽屏下脚注侧栏的宽度                       |
| `--layout-sidenote-gap`   | `10%`    | 正文和脚注侧栏之间的间距                   |

### 示例：更宽的内容区

宽屏上，阅读栏占页面框架的固定比例，框架放宽，阅读栏也跟着变宽。窄于 `1024px` 时，阅读栏保持 `35rem`，与框架宽度无关。

```css
:root {
  --layout-body-max-width: 1280px;
}
```

### 侧注与缩进块

脚注使用语义化的 HTML：正文里是上标的脚注引用链接，正文之后是原生的有序尾注列表。在详情页和公开的时间线列表里，Jant 按每篇帖子的实际容器（而不只是视口）判断右侧有没有空间放 Tufte 风格的侧栏。容器至少 `56rem` 宽、脚注放得下又不会溢出太多时，一小段渐进增强的脚本会把现有的尾注列表移到侧栏。时间线里的每一项单独测量。容器较窄或脚注较密、打印、不运行 JavaScript 的客户端以及旧浏览器，都保留底部尾注。

这段脚本读取每个脚注引用的实际位置，而不是把浮动元素锚定在所在的块上，所以引用块或其他正文块带内边距时，不再需要额外的锚点偏移。侧栏编号和脚注文字同样大小、同一基线。侧栏的比例和语义颜色用主题 token 调整：

```css
:root {
  --layout-sidenote-width: 42%;
  --layout-sidenote-gap: 8%;
  --type-footnote-ref: calc(var(--type-body-size) * 0.75);
  --site-footnote-text: var(--site-reading-caption);
  --site-footnote-marker: var(--site-text-secondary);
}
```

侧栏在视觉上隐藏返回箭头，因为每条脚注已经紧挨着它第一次被引用的位置。返回链接仍然保留在语义 HTML 里，供底部尾注和辅助技术使用，键盘用户聚焦到它时会显示出来。

主题选择器优先用 `.footnote-endnotes`、`.footnote-list`、`.footnote`、`.footnote-ref` 和 `.footnote-backlinks`。片段 ID 不透明，不同的 HTML 格式版本之间可能变化，不要给它们的压缩哈希写样式，也不要解析它。

## 媒体与头像

| 变量              | 默认值   | 作用            |
| ----------------- | -------- | --------------- |
| `--media-radius`  | `0.5rem` | 图片 / 视频圆角 |
| `--avatar-size`   | `28px`   | 页头头像尺寸    |
| `--avatar-radius` | `50%`    | 头像圆角        |

## 数据属性（data attributes）

写选择器时可以用这些 data attribute 锁定特定页面或元素：

| 属性                 | 出现在      | 取值                                                                                      |
| -------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `data-theme`         | `<html>`    | 当前配色主题 id（`tufte`、`linen`、`frost` …）                                            |
| `data-theme-mode`    | `<html>`    | `auto`、`light`、`dark`                                                                   |
| `data-page`          | `<body>`    | `home`, `post`, `search`, `archive`, `collection`, `collections`, `featured`, `subscribe` |
| `data-post`          | `<article>` | 每篇帖子都会带上                                                                          |
| `data-format`        | `<article>` | `note`, `link`, `quote`                                                                   |
| `data-post-slug`     | `<article>` | 帖子的 slug（便于调试和按帖子定制样式）                                                   |
| `data-post-pinned`   | `<article>` | 置顶帖子会带上                                                                            |
| `data-post-featured` | `<article>` | Featured 帖子会带上                                                                       |
| `data-feed`          | 信息流容器  | 包裹帖子列表                                                                              |
| `data-authenticated` | `<body>`    | 登录时带上                                                                                |

帖子内部还有四个标记：`data-post-body`（正文，引用帖是评论）、`data-post-quote`（引用帖的引文）、`data-post-meta`（日期和合集）、`data-post-media`（附件：图片、视频、音频、文档和文本附件）。有了它们，可以针对帖子的某一块单独写样式。

### 示例：只在首页加分隔线

```css
[data-page="home"] [data-post] {
  border-bottom: 1px solid var(--border);
  padding-bottom: 1.5rem;
}
```

### 示例：按格式区分样式

```css
[data-post-quote] {
  font-family: var(--font-serif);
  font-style: italic;
}

[data-format="link"] {
  border-left: 3px solid var(--site-accent);
  padding-left: 1rem;
}
```

### 示例：突出置顶帖子

```css
[data-post-pinned] {
  background: var(--muted);
  border-radius: 8px;
  padding: 1rem;
}
```

## 深色模式

站点默认跟随访问者的系统偏好（浅色 / 深色），也可以设为始终浅色或始终深色，`<html>` 上的 `data-theme-mode` 标明是哪一种。页面变成深色有两种情况，所以深色值要写两条规则：

```css
:root {
  --site-threadline: oklch(0.8 0.05 250);
}

/* 站点设为深色 */
:root[data-theme-mode="dark"] {
  --site-threadline: oklch(0.45 0.05 250);
}

/* 系统是深色，且站点没有设为浅色 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme-mode="light"]) {
    --site-threadline: oklch(0.45 0.05 250);
  }
}
```

选择器照这样写。内建主题用的是同样的选择器，Custom CSS 排在它后面，所以你的值会生效。media query 里只写 `:root` 的话，优先级更低，会输给主题的深色值。

## 提示

- 优先改变量，再考虑写选择器覆盖。本页列出的变量、数据属性和 class 只在大版本里变动；Jant 样式表里的其他自定义属性和 class 属于内部实现，任何版本都可能改变。
- Custom CSS 排在内建主题之后，用的也是同样的选择器，所以能覆盖主题设置的每个变量：浅色值写在 `:root` 里，深色值用[深色模式](#深色模式)里的两条规则。
- 颜色用 `oklch()` 比较好控制。一个常见做法：`--primary` 用饱和、稳定的颜色给按钮；`--site-accent` 用更柔和的颜色给引号和 Thread 连接线。链接用 `--site-content-link`。
- 浅色和深色都要测。只写在 `:root` 里的颜色，在主题和 Jant 都没有给它设深色值的地方，深色模式下也会生效。

## 接下来

- [代码注入](code-injection.md) —— 嵌入第三方脚本、外部字体、统计代码、评论组件
- [导出与导入](export-and-import.md) —— 站点迁移和归档
