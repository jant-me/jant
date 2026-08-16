# Setup 首次运行外壳

## 问题

hosted 用户从 jant-cloud 建站后，经 SSO handoff 落到自己域名的 `/setup`，看到的第一屏是：
一行小灰字站名 + 「What language do you write in?」+ 一个下拉框 + 一个按钮。

- 没有任何标识说明这是首次运行的一步（没有 Jant 标、没有「设置」字样）
- 只问一句、却不交代另外几项（账户、网址）已由谁答过，于是这一问像随机拦路
- self-hosted 那侧有「Welcome to Jant」+ 两组字段，两边气质不对称

## 决策（已与用户确认）

1. **hosted 仍只问语言**，不加站名/简介编辑 —— 只补外壳与上下文
2. **提交后行为不变**（仍落到 `/`）
3. **两侧共用一屏外壳**，差异只是渲染哪几组，不拆两套 UI

## 任务

- [x] `routes/auth/setup.tsx`：抽出 `SetupShell`（品牌标 + 「初始设置」eyebrow + 卡片 + 脚注）
- [x] 卡片头部显示站点身份：hosted = 站名 + 域名；self-hosted = 域名
- [x] hosted 增加「账户和网址已由 {provider} 准备好，只剩这一项」只读说明，
      provider 用 `getHostedControlPlaneProviderLabel`（已自带 hostname 兜底），
      无 provider 时降级为不点名的整句（不是留空占位符）
- [x] self-hosted 增加脚注「这些之后都可以在设置里更改。」
- [x] 浏览器标题走 i18n，不再硬编码英文；与 eyebrow 共用 `setupLabel()`
- [x] i18n：新增 en 源串 + zh-Hans / zh-Hant 翻译
- [x] 测试：新增 `__tests__/setup-page.test.tsx`（9 例，两种模式 + provider 兜底）
- [x] `check-lint` + `tsc` + 测试

## 追加：setup 页的中文文案从来没有生效过

浏览器验证时发现的真实缺陷，与本次 UI 改动无关但同属「新用户很懵逼」：

- `lingui.config.ts` 按**文件路径**分目录：只有 `routes/dash/**` 和 `ui/dash/**`
  进入被翻译的 settings catalog，其余全进 public catalog。
- 运行时 `i18n/i18n.ts` 只 import `public/en` + `settings/{en,zh-Hans,zh-Hant}`，
  **`public/zh-Hans.po` / `public/zh-Hant.po` 永远不会被加载**。
- 于是 `routes/auth/setup.tsx` 的 23 条串虽然在 public 里有完整中文（上一轮任务
  手写的 18 条也在其中），页面上一直是英文 —— 中文站的作者、从中文控制台点进来的
  hosted 作者，看到的都是全英文的首次运行页。
- 修法：把 `routes/auth/setup.tsx` 显式加进 settings catalog 的 `include`、
  并加进 public catalog 的 `exclude`，把原有中文 msgstr 搬进 `settings/*.po`。
- `signin.tsx` / `reset.tsx` 不动：`i18n/middleware.ts` 的 `ADMIN_PATH_PREFIXES`
  只含 `/settings`、`/dash`、`/setup`，其余路由一律 `baseLocale`，
  搬 catalog 也不会生效，属于另一个决定。
- 规则已写进 `tasks/lessons.md`。

## 追加：砍到一行（用户反馈「有点丑，元素太多」）

第一版做成了品牌标 + 右上角「初始设置」+ 卡内身份行 + 已就绪说明 + 脚注，
在真站点上（长域名 + 真站名）读起来是一堆灰字包着一个下拉框。全部撤掉：

- 删掉 `JantBrandMark` 那一行外部 masthead —— logo 放在这里没有作用，只有装饰。
- 删掉域名（浏览器地址栏已经有了）、删掉「账户和网址已由 X 准备好」、删掉脚注，
  连带删掉 `providerLabel` / `resolveSetupAddress` 管道和 3 条 msgid。
- 身份和步骤压成卡内一行：`初始设置 · 行混`（自部署时站点还没有名字，只显示「初始设置」）。

## 结果

- 两种模式共用 `SetupShell`，卡内只有一行灰字标签 + 标题 + 说明。
- hosted：「初始设置 · 行混」/「你写作的主要语言是？」/ 语言选择 /「开始写作」。
- self-hosted：「初始设置」/「欢迎使用 Jant」/ 站点、账户两组 /「完成设置」。
- setup 页首次真正按语言渲染（tab 标题也是）。
- 验证：`check-lint` 通过；`tsc --noEmit` 通过；简化后 `setup-page.test.tsx` 6 例
  与 auth / i18n / onboarding 共 100 例通过；简化前全量 `npx vitest run` 3527 通过，
  1 个失败 `cli-site-snapshot.test.ts`「auto-remaps a snapshot into the only
  initialized site」—— 在干净工作树上同样失败，与本次改动无关。
  浏览器实测 provisioned / pending 两态 × 英文 / 简体中文。
