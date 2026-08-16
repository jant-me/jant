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

| 变量                    | 默认值                      | 作用                                  |
| ----------------------- | --------------------------- | ------------------------------------- |
| `--site-accent`         | `var(--primary)`            | 阅读区强调色（链接、Thread 连接点等） |
| `--site-accent-text`    | `var(--primary-foreground)` | 站点强调色上的文本                    |
| `--site-page-bg`        | `var(--background)`         | 页面整体背景                          |
| `--site-elevated-bg`    | `var(--background)`         | 主内容区和浮层（菜单、popover）的背景 |
| `--site-nav-hover-bg`   | `var(--accent)`             | 导航 hover 背景                       |
| `--site-text-primary`   | `var(--foreground)`         | 主文本                                |
| `--site-text-secondary` | `var(--muted-foreground)`   | 次级 / 说明文本                       |
| `--site-divider`        | `var(--border)`             | 内容分隔线                            |
| `--site-threadline`     | `var(--border)`             | Thread 连线                           |
| `--site-column-outline` | `var(--border)`             | 内容块描边的派生基色                  |
| `--site-media-outline`  | `var(--border)`             | 图片 / 视频边框                       |
| `--search-mark-bg`      | 内置黄底                    | 搜索结果高亮背景                      |
| `--search-mark-color`   | 内置深字                    | 搜索结果高亮文字                      |

### 示例：自定义主色和站点强调色

```css
:root {
  --primary: oklch(0.48 0.08 255);
  --primary-foreground: oklch(0.98 0 0);
  --site-accent: oklch(0.56 0.06 240);
}

@media (prefers-color-scheme: dark) {
  :root {
    --primary: oklch(0.79 0.06 255);
    --primary-foreground: oklch(0.19 0.01 255);
    --site-accent: oklch(0.74 0.07 240);
  }
}
```

### 示例：让 Thread 连线带颜色

```css
:root {
  --site-threadline: oklch(0.8 0.05 250);
}
```

## 排版变量

| 变量                | 默认值                  | 作用                                       |
| ------------------- | ----------------------- | ------------------------------------------ |
| `--font-body`       | 系统 sans-serif         | 正文、输入框                               |
| `--font-heading`    | 偏编辑风格的 serif 组合 | 帖子标题、h1–h3                            |
| `--font-site-title` | 偏编辑风格的 serif 组合 | 站点 logo（标题栏）                        |
| `--font-ui`         | 系统 sans-serif         | 按钮、导航、标签、徽章（不受字型主题影响） |
| `--font-serif`      | 系统 serif + Noto 回退  | serif 强调文本                             |
| `--font-blockquote` | `inherit`               | 引用块字族，默认跟随正文字体               |
| `--font-mono`       | 系统 monospace          | 代码块                                     |
| `--fw-light`        | 300                     | 轻量强调                                   |
| `--fw-regular`      | 400                     | 正文                                       |
| `--fw-medium`       | 500                     | 标签、激活导航                             |
| `--fw-semibold`     | 600                     | 标题、按钮                                 |
| `--fw-bold`         | 700                     | 强强调                                     |
| `--fw-extrabold`    | 800                     | 站点 logo                                  |

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

| 变量                  | 默认值   | 作用                 |
| --------------------- | -------- | -------------------- |
| `--content-max-width` | `42rem`  | 内容最大宽度         |
| `--site-padding`      | `1.5rem` | 横向内边距           |
| `--content-gap`       | `1rem`   | 信息流条目之间的间距 |

### 示例：更宽的内容区

```css
:root {
  --content-max-width: 55rem;
}
```

## 卡片与媒体

| 变量                  | 默认值   | 作用             |
| --------------------- | -------- | ---------------- |
| `--card-radius`       | `0`      | 帖子卡片圆角     |
| `--card-padding`      | `1rem`   | 帖子卡片内边距   |
| `--card-border-width` | `0`      | 帖子卡片边框宽度 |
| `--card-shadow`       | `none`   | 帖子卡片阴影     |
| `--media-radius`      | `0.5rem` | 图片 / 视频圆角  |
| `--avatar-size`       | `28px`   | 页头头像尺寸     |
| `--avatar-radius`     | `50%`    | 头像圆角         |

### 示例：把帖子做成卡片

```css
:root {
  --card-radius: 12px;
  --card-padding: 1.5rem;
  --card-border-width: 1px;
  --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
```

## 数据属性（data attributes）

写选择器时可以用这些 data attribute 锁定特定页面或元素：

| 属性                 | 出现在       | 取值                                                                         |
| -------------------- | ------------ | ---------------------------------------------------------------------------- |
| `data-theme`         | `<html>`     | 当前配色主题 id（`tufte`、`linen`、`frost` …）                               |
| `data-theme-mode`    | `<html>`     | `auto`、`light`、`dark`                                                      |
| `data-page`          | 页面外层容器 | `home`, `post`, `search`, `archive`, `collection`, `collections`, `featured` |
| `data-post`          | `<article>`  | 每篇帖子都会带上                                                             |
| `data-format`        | `<article>`  | `note`, `link`, `quote`                                                      |
| `data-post-slug`     | `<article>`  | 帖子的 slug（便于调试和按帖子定制样式）                                      |
| `data-post-pinned`   | `<article>`  | 置顶帖子会带上                                                               |
| `data-post-featured` | `<article>`  | Featured 帖子会带上                                                          |
| `data-feed`          | 信息流容器   | 包裹帖子列表                                                                 |
| `data-authenticated` | `<body>`     | 登录时带上                                                                   |

帖子内部还有三个标记：`data-post-body`（正文容器）、`data-post-meta`（日期、标签等元信息）、`data-post-media`（图片 / 视频区）。三个一组，便于针对帖子的某一块单独写样式。

### 示例：只在首页加分隔线

```css
[data-page="home"] [data-post] {
  border-bottom: 1px solid var(--border);
  padding-bottom: 1.5rem;
}
```

### 示例：按格式区分样式

```css
[data-format="quote"] [data-post-body] {
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

Jant 会自动跟随访问者的系统偏好（浅色 / 深色）。如果想为深色模式单独设置变量，可以用 media query：

```css
:root {
  --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

@media (prefers-color-scheme: dark) {
  :root {
    --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
}
```

站点也可以强制切换到深色模式（不跟随系统）。要在那种情况下也覆盖颜色，用 `:root[data-theme-mode="dark"]` 选择器。

## 提示

- 优先改变量，再考虑写选择器覆盖。变量层将来升级时不易破。
- Custom CSS 优先级最高，会覆盖内建主题里的所有变量。
- 颜色用 `oklch()` 比较好控制。一个常见做法：`--primary` 用饱和、稳定的颜色给按钮；`--site-accent` 用更柔和的颜色给链接和正文中的强调。
- 浅色和深色都要测。如果在 `:root` 里覆盖了某个颜色变量，也要想一想它在 `@media (prefers-color-scheme: dark)` 或 `:root[data-theme-mode="dark"]` 下是否需要对应覆盖。

## 接下来

- [代码注入](code-injection.md) —— 嵌入第三方脚本、外部字体、统计代码、评论组件
- [导出与导入](export-and-import.md) —— 站点迁移和归档
