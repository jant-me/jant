# Setup / first-run 统一

## 目标

一份 setup 代码同时服务自部署和 hosted，按"缺什么问什么"驱动，不做多步向导；语言选择器在 setup 和 settings 之间共用一个带搜索的组件。

## 背景事实

- `routes/auth/setup.tsx` 是一个表单 4 个字段（站点名、内容语言、邮箱、密码）。时区和后台语言已自动探测，不问用户（`services/bootstrap.ts:78-85`）。
- hosted 开站时 `services/site-admin.ts:301-335` 直接写设置并 `completeOnboarding()`，语言来自 jant-cloud 传的 `siteLanguage`。
- jant-cloud 传的是控制台界面语言（`apps/app/app/routes/user/sites-shared.ts:25` `siteLanguage: input.locale`），不是写作语言 —— 对"中文界面写英文博客"的人是错的，且会静默写进 `<html lang>` / feed / CJK 字体栈。
- jant-cloud 无任何代码读 onboarding 状态，本次改动 **不需要改 jant-cloud**。
- setup 是未登录页，BaseLayout 给 public bundle（`client.ts`）；settings 组件注册在 `client-auth.ts`。
- `client/components/jant-settings-language.ts:530-607` 的 `#renderLanguagePicker` 已是带搜索的 combobox，但只处理 Escape，没有方向键 / Enter 选中。

## 决策

1. **不分步**：4 个字段做向导没有收益，且会引入"账号已建、站点没配"的中间态。改为一屏两组：Site（名称 + 语言）/ Account（邮箱 + 密码）。
2. **hosted 也问，但只问一句**：在 core 问，不在 cloud 问。cloud 传的值降级为默认选中项。
3. **onboarding 三态**，避免 hosted 新站公开首页被重定向到 setup。

## 任务

### 1. 抽取共享语言选择器

- [ ] 新建 `client/components/jant-locale-picker.ts`（Lit，light DOM），承载 trigger + 搜索框 + listbox + 过滤逻辑（native / english / tag 三字段）
- [ ] 补键盘支持：↑/↓ 移动、Enter 选中、Escape 关闭、首字母跳转（AGENTS.md keyboard-first）
- [ ] `jant-settings-language.ts` 改为使用该组件，删除 `#renderLanguagePicker` 与相关 picker 状态
- [ ] 在 `client.ts`（public bundle）注册；Lit 已在 public bundle 中，增量只有组件本身。**不要**给 setup 页开 full bundle
- [ ] Datastar 桥接：隐藏 input + 派发 `input` 事件回填信号；原生 `<select>` 作为 SSR fallback

### 2. onboarding 三态

- [ ] `lib/constants.ts` 的 `ONBOARDING_STATUS` 增加 `PROVISIONED: "provisioned"`
- [ ] `services/settings.ts`：新增读取状态的方法（`getOnboardingStatus`），`isOnboardingComplete` 语义不变
- [ ] `services/site-admin.ts` 的 `completeManagedSiteSetup`：写入已知设置 + 默认导航后标记 `provisioned`，不再 `completeOnboarding()`；cloud 传的 `siteLanguage` 存为建议默认值
- [ ] `middleware/onboarding.ts`：按状态决定拦截范围
  - `pending` → 现状（`/`、`/signin`、`/reset`、`/settings`）
  - `provisioned` → 只拦已登录站主的后台入口，公开页放行
  - `completed` → 全放行
  - 内存缓存要按状态区分，不能把 `provisioned` 当成完成

### 3. setup 路由按缺失项渲染

- [ ] `routes/auth/setup.tsx`：计算待答项（owner 账号 / 站点名 / 内容语言）
- [ ] 自部署首次：一屏两组（Site / Account），语言字段换成共享 picker
- [ ] hosted 首次：只渲染一问 —— 标题「你写作的主要语言是？」，助记「可以随时在设置里更改。」，主按钮「开始写作」；站点名只读展示
- [ ] POST 分支：hosted 情形只写语言 + `completeOnboarding()`，不建账号

### 4. 文案与 i18n

- [ ] 新增/调整 en 源串 + `@context:` 注释
- [ ] zh-Hans / zh-Hant 翻译，遵循中文文案规则（全角标点、无「您」、不用感叹号）

### 5. 验证

- [ ] `routes/auth/__tests__/setup.test.ts` 扩展：三种状态的渲染与提交
- [ ] `middleware/__tests__/onboarding.test.ts` 扩展：三态拦截范围
- [ ] 新增 `jant-locale-picker` 组件测试（过滤、键盘导航）
- [ ] `jant-settings-language.test.ts` 回归
- [ ] `mise run check-tests` + `mise run check-lint`
- [ ] 本地 `mise run dev-debug` 手测自部署 setup 与 hosted 单问态

## 追加：后台语言被钉死为英文

浏览器验证时发现的真实缺陷（内容语言选简体中文，后台仍是英文）：

- `bootstrap.completeInitialSetup` 无条件写入 `DASHBOARD_LANGUAGE = resolveCatalogLocale(browserLanguage)`。
  `navigator.language` 多数机器是 `en`，于是后台被显式钉成英文，而显式值优先于「跟随内容语言」。
- 新规则（`i18n/locales.ts` 的 `resolveFirstRunDashboardLocale`）：只有当浏览器指向的 catalog
  既不是 `en`、又不同于内容语言解析出的 catalog 时才钉住；否则保持未设置以跟随内容语言。
  两个方向的错配都覆盖：英文站 + 中文浏览器 → 中文后台；中文站 + 英文浏览器 → 中文后台。
- `settings.tsx` 之前把「未设置」显示成解析后的 locale，导致下拉永远选不到「跟随内容语言」。
  改为原样传 `""`。

## 结果

- 共享 `<jant-locale-picker>`：搜索 + ↑/↓ + Enter + Escape + 外部点击关闭，settings 与 setup 共用。
- setup 一屏两组；hosted 单问「你写作的主要语言是？」，只对已登录站主拦截，公开页照常。
- onboarding 三态；jant-cloud 无需改动。
- `/setup` 纳入 admin locale 范围，首次 setup 按浏览器语言渲染；新增 18 条 setup 中文文案。
- 验证：`npx vitest run` 266 文件 / 3485 用例全绿；`mise run check-lint` 通过；浏览器实测
  自部署 setup（搜索「chinese」→ ↑/↓ → Enter → 表单确实提交 `contentLanguage: "zh-Hant"`）
  与设置页后台语言显示。
- 遗留（与本次改动无关，clean tree 上已存在）：`routes/pages/collection.tsx` 6 个
  `c.req.param("slug")` 的 `string | undefined` 类型错误，导致 `mise run check-types` 红。
