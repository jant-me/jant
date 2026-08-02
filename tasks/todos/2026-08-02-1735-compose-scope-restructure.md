# Compose 作用域重构

把 compose 里混在一起的两种作用域拆开，并修掉发现的日期 bug。

## 背景

compose 现在把 per-post 属性（日期、slug）和 per-thread 属性（可见性）放在同一个底部面板里，
thread 模式下「这个日期改的是谁的」没有答案。同时底部那个 `▲` 折叠按钮用户普遍找不到。

数据层其实已经把作用域定死了：

| 字段           | 数据层作用域 | 证据                                                                                     |
| -------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `visibility`   | thread       | reply 存 NULL，读取时从 root 继承（`post.ts:1852`）；改 reply 直接拒绝（`post.ts:2372`） |
| `published_at` | per post     | 每条独立列（`schema.ts:167`），编辑单条 reply 时可改                                     |
| slug           | per post     | `path_registry` 每条一份                                                                 |
| collections    | thread       | `compose.tsx:229` 只给 index 0                                                           |

UI 只需要照实说。设计定稿见本次会话的原型（v9）。

## 定稿设计

**post 块顶部行**（thread 模式）
`1/N  [Note|Link|Quote]  ...  [📅 Now · 🔗 Auto]  ×`

- 计数器在最左（身份先于属性），只在 thread 模式渲染
- 格式选择器**只有这一处** —— dialog header 的那份删掉，header 中间永远是标题
- pill 只在悬停 / 聚焦 / 有值时浮现；用 `margin-left:auto`，出现消失不推动 `×`
- 单条模式没有 pill（一条 post 时「这条」＝「这次发布」）

**底栏**
`[◇ Reading]        [中文]  [🌐 Publish]  [▤]`

- 可见性图标留在 Publish 按钮上（现状即如此）
- 语言 chip 在 Publish 左边，仅当设置里配了 ≥2 种语言
- Options 纯图标按钮在 Publish 右边，打开竖排面板
- 删掉 `▲` split toggle、`_renderQuickActionsRow`、`_renderPublishSummaries`

**Options 面板**（Threads 竖排样式）
灰色分组标题 → 整行可点 → 选中打勾 → 值/开关靠右 → 组间发丝线。
日期和 permalink 用 drill-in：一行显示当前值 + `›`，点进去才展开编辑器。

## 分阶段

### Phase 1 — post 块顶部行（纯前端）✅

- [x] `_renderFormatHeader` 改为所有模式都渲染（含单条），加 `1/N` 计数器
- [x] `_renderHeader` 删掉 `showTitle` 三元分支，中间永远是标题
- [x] 新增 `newPost` 标签 —— 单条模式头部不能再说 "New Thread"
- [x] CSS：header 从 `space-between` 改成 `gap` + remove 按钮 `margin-left:auto`
- [x] 更新受影响的测试（2 处），新增 2 个测试（单条选择器位置、`1/N` 计数）
- [x] 3020 tests / lint / typecheck 全绿；浏览器实测单条 + thread 两种形态

### Phase 1.5 — reply 日期继承 root（数据 bug）✅

独立于 UI，先修掉。

- [x] `createThreadWithAttachments`：reply 未指定 `publishedAt` 时继承 root 的时间戳
- [x] 确认排序安全：thread 查询按 `createdAt, id` 排（`post.ts:3539`），不看 `publishedAt`
- [x] 3 个回归测试：回填继承 / reply 自带日期优先 / 草稿仍为 null

### Phase 4 — 视觉统一 + 日期/permalink 下沉到 post ✅

对齐原型（v9），并把 Options 收回纯 thread 作用域。

- [x] 格式选择器：三个独立描边 tag → 一组 segmented（沿用基础样式，去掉滑动指示条；
      items 现在按标签宽度排版，三等分的 pill 对不齐）
- [x] Add to thread：去掉虚线边框，改成无边框文字按钮
- [x] thread 连线：渐变改成实色 1.5px（之前几乎看不见）
- [x] Options 图标：改用原型的 24 网格圆角方框滑块（16 网格下线条会糊成一团）
- [x] 新增 editor 的 `headerExtra` 插槽；dialog 把日期/permalink pill 塞进 root post 的头部行
- [x] pill：`📅 Now · 🔗 Auto`，悬停/聚焦/有值时才浮现，`margin-left:auto` 保证不推动 `×`
- [x] Options 面板去掉 Published on / Custom link 两行 —— 它们描述单条 post，不描述整次发布
- [x] 文案：`Publish now` → `Now`，`Auto link` → `Auto`（pill 里跟图标并排，短的更好读）
- [x] 3025 tests / lint / typecheck / format 全绿；浏览器实测 pill、面板、图标

### Phase 4.1 — 间距修正 ✅

实测量出来的，不是看截图猜的。对话框有三套 gutter：控件行 18px、正文 24px、
工具条 16px。

- [x] **单条模式的编辑器不能包在 `.compose-editor-row` 里** —— 那条规则里有
      `.compose-editor-row .compose-body { padding-left: 减掉 }`（注释写着「rail 已经提供缩进」），
      而单条模式没有 rail，正文左边距直接塌到 0。改成 `display: contents` 的包装层，
      只做事件委托，不参与布局。
- [x] 格式行取 **16px**（工具条的 gutter，不是正文的 24px）—— 它是控件行，
      这样 segmented 的盒子边和下面第一个工具按钮完全对齐（实测都是 L+16）
- [x] thread 里 `.compose-post-meta` 和 `×` 都写了 `margin-left:auto`，两个 auto
      会平分剩余空间，把 pill 甩到行中间（实测 R-150）。改成只有第一个吃掉空白
- [x] thread 的 post header 右边距补 16px，`×` 和 pill 与下方 fullscreen 按钮对齐
      （实测都是 R-31）
- [x] rail 竖线从 `top: 0` 改成 `1.35rem`，不再在第一个 dot 上方留一截
- [x] pill 的浮现规则从 `.compose-editor-row:hover` 改成 `jant-compose-editor:hover`
      —— 单条模式已经没有那个 row 了

**教训**：`getComputedStyle` 在 `<dialog>` top layer + Lit 重渲染下会给出误导性的值
（连 inline `!important` 都「无效」）。最后是靠真实鼠标 hover + 截图确认的。
量位置用 `getBoundingClientRect` 可靠，量级联状态不可靠。

**踩到的坑**：`_refreshSuggestedSlug` 在 fetch 返回后还有第二道
`!this._showPublishPanel` 判断，slug UI 搬家后这一道会把结果丢掉 —— 只改调度处的
gate 不够，resolve 处的也要改。

### Phase 5 — 每条 reply 的日期覆盖 ✅

每条 post 都有完整的 `日期 · permalink`。

> 我一开始为了省范围只给 reply 做了日期，被指出来了 —— reply 有真实的 permalink
> （`path_registry` 每条一份），原型 v9 的 reply 面板里也确实有那一行。
> **不要因为「用户很少用」就悄悄砍掉数据模型支持的东西**，频率决定默认藏不藏，
> 不决定存不存在。

- [x] `ThreadItem` 增加 `publishedAtInput` / `publishedAtTimeMinutes` / `slug` / `slugTaken`
- [x] `_showPostMeta: boolean` → `_postMetaIndex: number | null`（一次只开一个）
- [x] 索引化访问器：index 0 读写原有的 `_publishedAtInput`（所有既有的
      编辑/草稿/提交路径完全不用改），index > 0 读写 `_threadItems[i]`
- [x] reply 留空时 pill 显示 root 的日期而不是「Now」—— 它确实继承 root
- [x] `_canPublish` / `_focusBlockedSubmitField` 遍历所有 post 校验日期，
      有问题时直接打开出错那条的面板
- [x] `compose.tsx:232` 放开 `index === 0`；schema 本来就支持 per-post
      `publishedAt`（`schemas.ts:297`），服务端 Phase 1.5 已做 `?? rootPublishedAt`
- [x] 本地草稿带上这两个字段（存 + 读）
- [x] slug 可用性检查按 index 回写结果（面板一次只开一条，单个 timer 够用）；
      slug 建议仍只给 root —— 它是从标题推的，reply 没有标题
- [x] `compose.tsx` 的 `slug` 也放开 `index === 0`
- [x] 4 个新测试：每条都有日期+permalink / reply 自带日期发出去、未设置的发 undefined /
      reply 自带 permalink 发出去、非法 slug 阻止发布 / 任一条日期在未来则禁止发布

### Phase 6 — 交互修正 ✅

- [x] **可见性选完直接关闭面板**，Options 面板的 Done footer 删掉 ——
      单选不需要确认
- [x] **日期/permalink 面板补上 Done** —— 那里有输入框，需要一个明确的收起动作
- [x] `1/N` 计数器移到格式选择器**右边**
- [x] Add to thread hover 的抖动 + 丑边框：Phase 4 那次批量替换只删掉了
      `border-color`，把孤立的 `border-style: solid` 留了下来。base 是
      `border: none`（即 `style:none; width:medium`），hover 时打开 style
      就变成 medium(≈3px) 实线边框 —— 边框和 6px 的盒子跳动都来自这一行。
      两处都删掉，现在 hover 规则只剩 `color` / `background-color`，
      不含任何几何属性，抖动在结构上不可能发生。

**教训**：批量删声明时要连同一条规则里的相关声明一起看。`border-color` 和
`border-style` 是一组，只删一半会让 `border: none` 的基线在 hover 时被激活。

### Phase 3 — 底栏 + 竖排面板 ✅

纯表现层：行为、payload、校验逻辑一律不变，只换了摆放和入口。

- [x] 新增 sheet 样式（`.compose-sheet-*`、`.compose-options-trigger`）
- [x] `_renderPublishPanelSections` 重写为竖排列表：灰标题分组 → 整行可点 →
      选中打勾 → 值靠右；三种可见性各带一句副标题（chip 布局塞不下）
- [x] 日期 / Custom link 改 drill-in（`_publishDrill` state），点开才展开编辑器并聚焦
- [x] Publish 拆回单按钮；Options 变成它右边一个独立图标按钮
- [x] 删 `_renderQuickActionsRow`、`_renderPublishSummaries` / `_renderPublishSummary` /
      `_getPublishSummaryChips` / `_getSlugSummary` / `ComposePublishSummaryChip`
- [x] 删 37 个死掉的 CSS 规则块（-304 行）
- [x] 测试：25 处选择器改名 + 17 处补 `openDrill` + 6 个 summary 测试改写成
      「折叠行的值」+ 2 个新测试（独立按钮 / drill 折叠行为）
- [x] 3025 tests / lint / typecheck / format 全绿；浏览器实测面板与图标

**踩到的坑**：`_getPublishedAtRowValue` 一开始复用了 `_getPublishedAtSummary`，
但那个函数的语义是「没改过就返回 null」（chip 只在变更时出现）。折叠行必须永远显示
当前值，所以改成直接格式化 `_publishedAtInput`。

### 后续（本次不做）

- `post.via_url` 字段 + link/quote 的 via 开关（双方言 schema + migration）
- `post.lang` 字段（抄 visibility 的 root 继承子查询）+ 设置里的语言列表

## 验证状态

已跑：`check-tests`(3025) / `check-lint` / `check-types` / `check-format` /
`i18n-check`（二次构建幂等；public catalog 按设计不翻译，空 msgstr 正常） /
`check-template`。

浏览器实测：新建单条、新建 thread（含 pill、Options 面板、图标、各行 gutter 实测对齐）。

**还没看过的形态** —— 这些都新增了格式头部行和 pill，有真实的布局风险：

- [ ] Reply 模式（`_visibilityLocked` + `inlineFormat` + 上方的父帖上下文）
- [ ] Edit 模式（`openEdit`，含编辑 reply）
- [ ] 窄屏：格式行现在装了 `1/N + segmented + pill + ×`，360px 下会不会挤爆
- [ ] 暗色主题
- [ ] `/compose` 整页模式（`pageMode`）
