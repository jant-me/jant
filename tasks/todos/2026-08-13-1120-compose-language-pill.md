# Compose：语言选择从 Options 面板挪到 Post 左边

## 背景

多语言功能其余部分已完成。目前 compose 的语言选择是 Options（发布设置）面板
里的一组 radio，作者看不到「这篇会以什么语言发出去」，只有在发布那一刻检测与
页面语言不一致时才会弹一张确认 sheet。

## 目标

Post 按钮左边露出一颗语言 pill，常驻显示这篇会发成什么语言；点开是同一组选项。

## 最终形态（下面几轮是怎么走到这儿的）

- pill 在 Post 左边，图标是站点右上角切换器那颗 globe（同一份 artwork）。
- 只在有话说的时候才写出语言名：自动态且结果就是页面语言 → 只有 globe；
  检测挪走了或作者选过 → 长出语言名，首次出现带一次很轻的淡入。
- 点开是 popover：Detect（诚实汇报读到什么，或「文字还不够」）+ 每个语言一行。
- **没有发布前的确认弹窗**，也没有任何与之配套的偏好开关。

## 待办

- [x] 读全现有实现，确认交互与数据链路
- [x] pill + popover（复用 `_renderLanguageRow`）
- [x] Options 面板里的语言段落移除（避免第二真相源）
- [x] 检测实时化：render 直接读 `_effectiveLanguage()`，随 `_onContentChanged`
      已有的 `requestUpdate()` 一起刷新，不加缓存不加去抖
- [x] 确认 sheet 加 `#languageSeen` 抑制
- [x] popover 的开关互斥、Escape、外部点击、焦点归还
- [x] 修洞：编辑已发布文章时 `_language` 没有从 post 上种回来，提交会用
      「页面语言 + 检测」重新推一个语言覆盖原值
- [x] 语言纳入未保存改动快照
- [x] 新增 pill 的 aria 文案 + 三语 .po
- [x] CSS
- [x] 测试

## 第二轮（作者回看之后）

- [x] 图标改用站点右上角切换器那颗 globe，同一份 artwork
- [x] pill 默认只露 globe；只有「检测挪走了语言」或「作者选过」才写出语言名
- [x] 检测加阈值：`MIN_SIGNAL = 10`，CJK 字符 3 分 / 拉丁字母 1 分；不够就
      回落页面语言。放在 `lang-detect.ts` 里，服务端给 API/bot 兜底走同一
      条规则
- [x] 同处修掉耦合的老问题：`han > 0` 原本在 `latin` 之前短路，一篇英文里
      引一个汉字就被读成中文。改成比较双方信号量
- 保留自动检测。理由：Jant 是单作者，有 Bluesky/Mastodon 没有的信号——你从
  哪个页面打开的 composer；检测只服务「从主语言首页写另一种语言」这一个
  高频动作，而且现在它的答案摆在 Post 旁边，是可以一键否决的建议而不是
  隐藏的猜测。要撤掉的话只需让 `_detectedLanguage()` 直接返回上下文语言

## 第三轮（作者纠正）

- [x] 「打开过 pill 就不弹窗」撤销。**只有明确选了某个语言才算回答**，停在
      「自动」上看多久都不算——`#languageSeen` 整个删掉，闸门回到 `_language`
- [x] 低于阈值时 Detect 那行不再谎称「看起来像 X」。检测器新增
      `readContentLanguage()`（读不出来就返回 null），`detectContentLanguage`
      变成它 `?? fallback`；composer 用 null 区分「读出来了」和「读不出来，
      先按页面语言算」
- [x] 记住作者的喜好：`jant:compose-language-check`（localStorage，与
      `jant:compose-note-title` 同一套习惯存法），默认开
- [x] 开关在两处出现：确认 sheet 里（被打扰的那一刻）和语言 popover 底部
      （扳回来的地方）

## 第四轮（sheet 里那个控件的形态）

第三轮把 sheet 里的开关做成了和 popover 一样的 switch + 两行说明，压在问题和
答案中间——体量和位置都错了：它比答案还重，而且插在「问题 → 回答」的动线上。

- [x] 改成 checkbox「Don't ask again」，放在**所有答案之后**（Cancel 下面），
      小字、次级色、无说明。它不是第四个答案，也不是一个当场要你配置的设置
- [x] popover 里保留正向 switch + 完整说明——那里它确实是个设置
- [x] 勾选**不立即生效，跟着答案一起提交**：勾了再按 Cancel 等于什么都没说。
      Cancel 的意思是「我还没回答」，这时候记下「别再问了」，下一篇就会静默
      按检测结果发，而那可能正是按 Cancel 想躲开的

### 文案

- `languageAutoPending`：`Not enough text to tell yet — publishes in {language}`
- `languageCheckLabel`：`Check the language before publishing`
- `languageCheckHint`：`Ask when what you wrote doesn't look like {language}.`
  ——`{language}` 是页面语言，也就是检测拿来比对的那个，把比较对象说死

## 第五轮（弹窗整个删掉）

作者指出：sheet 有两个并列答案（Publish in English / Publish in 简体中文），
一个「不再提示」勾选无法表达「以后按哪个」——用户勾的时候不知道下次默认是
什么。这是我建的东西的真漏洞，不是文案能补的。

要说清楚只有一条路：把勾选绑到按钮上，偏好从两态变三态（问 / 信检测 / 只用
页面语言），popover 底部的 switch 也得改成三选一列表。为管理一个打扰搭三态
状态机，不值。

**决定：弹窗整个删掉。** 因为 pill 写出语言名的条件与弹窗的触发条件完全重合
——检测读出的语言 ≠ 页面语言。每一次弹窗会出现的场合，Post 左边早就变成了
「English」。

- [x] 删除 `_maybeConfirmLanguage` / `_langConfirm` / `#langConfirmResolve` /
      `#cancelLanguageConfirm` / `_renderLanguageConfirmPanel`，以及 Enter、
      Escape、`requestClose` 三处分支；`_submit` 恢复同步
- [x] 删除 `_languageCheck` / `_langConfirmSilence` / `_LANG_CHECK_KEY` /
      `_renderLanguageCheckSwitch`，popover 回到纯语言列表
- [x] 删除 6 条文案（`languageConfirm*` ×4、`languageCheck*` ×2）与
      `.compose-confirm-silence*` 样式
- [x] 兜底改成非打断：pill 上的语言名首次出现时有一次 0.22s 淡入
      （`prefers-reduced-motion` 下取消）。它由 Lit 插入 `<span>` 的时机天然
      触发，不需要任何状态
- [x] 测试：`publish-time check` 整个 describe 换成 `publishing on automatic`
      ——按 Post 直接发出、pill 上写的就是落库的语言、显式选择不被二次猜测

## 结果

改动落在：

- `lib/lang-detect.ts`：新增 `readContentLanguage()`（读不出来返回 null）、
  `MIN_SIGNAL` / `CJK_WEIGHT` 两条「宁可不答」规则；`detectScript` 改成比较
  双方信号量而不是 `han > 0` 短路。
- `client/components/jant-compose-dialog.ts`：`COMPOSE_LANGUAGE_ICON`（globe）、
  `_renderLanguageControl` / `_renderLanguagePicker` / `_toggleLanguagePicker` /
  `_closeLanguagePicker`、`_readLanguage` 与 `_effectiveLanguage`；
  `_renderLanguageSection` 从 Options 面板移除；`openEdit` 种回
  `post.language`；快照加 `language`。
- `styles/ui.css`：`.compose-language*` 一组（含 bare 态、touch 尺寸、
  `compose-language-name-in` 淡入）。
- `ui/compose/ComposeDialog.tsx` + `compose-types.ts`：净新增两条文案
  （`languageAutoPending`、`languageTriggerLabel`），删掉三条
  （`languageConfirm*`）。
- 三个 public .po 由 `mise run i18n-build` 生成；zh 两份留空，与本功能其余
  文案一致（公开目录的中文翻译是另一趟活）。

## 验证

- `mise run check-tests`：265 files / 3462 tests 全绿
- `mise run check-types`、`mise run check-lint`、`prettier --check`：干净
- 期间一度有 3 条 nav 用例红，查明与本次改动无关（单独 stash 掉
  `lang-detect.ts` 后照样红），来自同一工作区里并行进行的「导航标签跟随
  目标」那摊活；对方收尾后已恢复
- 浏览器实测（`mise run dev-debug`，站点已开 4 语言）：
  - 空编辑器 / 只写了几个字 → 只有一颗 globe
  - 写够一句英文或日文 → pill 长出「English」/「日本語」
  - 按 Post → 直接发出，不拦；落库语言 = pill 上写的
  - popover 的 Detect 行如实汇报（读不出来时说「Not enough text to tell
    yet — publishes in 简体中文」）
  - Escape / 点外部关闭，焦点回到 pill；390px 宽下三个控件同排不挤
- 验证过程中产生的测试帖已用 `DELETE /api/posts/{id}` 清掉（核对过标题与
  创建时间）
