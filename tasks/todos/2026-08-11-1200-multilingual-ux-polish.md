# 多语言 UX 打磨(三件套)

来源:与作者的设计讨论(2026-08-11)。结论:URL 设计不动(文章 permalink 语言中立),
把「详情页归属语言视图」补齐在渲染层,并优化两处交互。

## 1. 详情页骨架按文章语言归位 + 语言视图更像首页

**规则(写入设计意图)**:文章页属于它自己语言的站——logo、导航、搜索、home 判定
全部落在 `post.language` 对应的视图上。站内动线上这与「保持读者来路视图」等价
(日语文章只能从 /ja 表面到达),确定性渲染、缓存安全。

- [x] `view-language.ts`:新增 `languageScopeBasePath(c, lang)`——lang 为已启用的
      非主语言时返回 `/ja` 形式前缀,否则空串
- [x] `navigation.ts`:`getNavigationData` 加 `languageScope` 选项,详情页用文章语言
      替代 `viewLang` 计算 `basePath`
- [x] `SiteLayout.tsx`:`SiteHeader` 与 `SiteLayout` 接 `basePath`;logo、搜索、
      drawer 品牌链接、`isHomePage` 判定全部改用 basePath(顺带修复 /en 列表视图下
      logo/搜索漏回主语言的既有 bug;/ja 由此获得 home 头部样式、站点简介、页脚、FAB)
- [x] `render.tsx` / `site-header-fragment.tsx`:透传 `navData.basePath`
- [x] `page.tsx` `renderPost` / `renderPostWithTextPreview`:传 `languageScope: post.language`
- [x] 测试:view-language 新 helper;navigation basePath;SiteHeader 链接

## 2. 发布时语言确认

规则:compose 的「Auto」在提交(发布)时解析为**当前页面语言**(context);
检测器只做绊线——检测结果与 context 不一致且有把握时,弹确认框
「This looks like 日本語」→ [Publish in 日本語(主按钮)] [Publish in 简体中文] [Cancel]。
一致或无信号则直接以 context 发布,不打扰。作者显式选过语言则永不弹
(显式选择不被二次质疑)。回复、单语言站、草稿保存不涉及。

- [x] context 语言链路:`renderPublicPage` 默认 `getViewLang(c)`,详情页传
      `post.language`;`SiteLayoutProps.composeContextLang` → `ComposeDialog`
      → `context-language` 属性
- [x] `jant-compose-dialog.ts`:`contextLanguage` 属性;`_effectiveLanguage`
      fallback 改为 context;`_submit("published")` 前置确认;自绘小对话框
      (复用 .confirm-dialog 样式,Escape 回编辑、Enter 确认检测语言)
- [x] `ComposeDialog.tsx` 新增三条 Lingui 标签(placeholder 客户端插值)
- [x] 测试:ComposeDialog 标签;组件行为(mismatch 弹/一致不弹/显式选择不弹)

## 3. 设置 → 语言 简化

- [x] 开启对话框:删掉「What turning this on does」四条 bullet(与页面开关帮助文案
      重复),压成一行安静的保证(地址不变、随时可关);保留打标警告
- [x] 开启后的主界面:主语言下拉 + Other languages chips + URL preview 三块
      合并为一个「Languages」列表——每行 = 语言名 + URL + Primary 徽标 /
      [Make primary] [×],心智模型变成「你的语言们,各有各的地址」
- [x] `LanguageContent.tsx` 标签增删,`LanguageContent.test.tsx` 同步

## 验证(已完成)

- `mise run check-tests`(3428 tests / 264 files)+ `check-lint` + `check-types` 全绿
- `mise run i18n-build`,zh-Hans/zh-Hant 100% 覆盖(4 条新设置文案手工翻译)
- 本地 dev 端到端:enable 多语言 → 发日语帖 → 详情页 `<html lang="ja">`、
  logo/导航/搜索全部 `/ja/*`;`/ja` 获得 home 样式并列出该帖;`/` 不列;
  主语言帖 chrome 在根;`/zh-hans`、`/ja/{slug}` 均 301;移除有帖语言被拒
- compose 确认弹层由组件测试覆盖(mismatch 弹/一致不弹/显式选择不弹/Escape 取消)

## 跟进(同日第二轮)

- [x] 设置语言列表的 URL 变为可点击链接(新标签页,`noopener noreferrer`)
- [x] 切换器默认 fallback 补完:`isPerLanguageSurface()` 白名单,无对应物的页面
      (settings/dash 等)一律指向该语言首页,`/ja/settings/*` 死链不再产生
- [x] 确认设计意图:dashboard 是单一驾驶舱,不随语言视图分叉(见设计文档 §19.4)

## 跟进(第三轮:文案与交互)

- [x] 移除语言拒绝 → 行内错误(本地化、带 count 与语言名)+「查看这些文章」链接
- [x] 多语言开关 checkbox → Turn on / Turn off 按钮(删掉 checkbox 回掰 hack)
- [x] contentLanguageHelp、打标警告(「尚未标记语言的文章」)、确认按钮分档文案
- [x] 切换器 globe 图标(不加国旗,W3C i18n 惯例)
- [x] 「Also available in …」移到正文之前
- [x] zh-Hans/zh-Hant 翻译补齐,i18n 100%;全量 3432 tests + lint + types 绿

## 跟进(第四轮:低调化与任务化)

- [x] 译本链接入 post meta:有标题文章 → 标题下 meta 行;其余 → footer 日期旁;
      globe + 语言原生名,无文案,aria-label 带完整句
- [x] 切换器 trigger 改 icon-only(globe + chevron),语言名只出现在菜单里
- [x] 设置页:关闭态 `+ Add language` 开启流程;开启态对称块 + `Turn off`;
      unmarkedPostCount=0 时警告块整体隐藏(修复「你还没有文章」误报)
- [x] 全量 3431 tests + lint + types 绿;dev 实测三处渲染

## 跟进(第五轮:回滚 meta-row,设置页定稿)

- [x] 译本链接回滚到统一的文末一句话(所有格式一致);meta-row 方案删除
- [x] 设置页三段式:Site / Multilingual content(独立节,状态徽标 + 行内开关链接)/ Dashboard
- [x] contentLanguageHelp 缩短为「你写作使用的语言。」;对话框确认按钮改「保存」
- [x] 修复关闭后重开入口不可见的问题(Off 状态 + Turn on 链接常驻)
- [x] 3431 tests + lint + types 绿;dev 实测两种帖型 + i18n 100%

## 跟进(第六轮:命名/行菜单/重开守卫/即时刷新)

- [x] 中文文案「多语言内容」→「多语言」(节/弹窗/toast 统一)
- [x] 语言行的「设为主语言」「删除」折进「⋯」菜单;主语言行仅徽标
- [x] **重开守卫**:enable() 校验「有帖语言 ⊆ 新列表」,堵住 remove 守卫的旁路;
      错误本地化并在弹窗内联显示(顺带修复 modal 下 toast 不可见)
- [x] 开启/关闭成功后 reload,切换器立即出现/消失
- [x] 3435 tests + lint + types 绿;dev 实测守卫三种场景;i18n 100%

## 跟进(第七轮:文案精修 + 弹窗守卫可操作化)

- [x] 多语言描述改为完整版(视图+发布选语言+译本关联),两状态共用
- [x] zh「开启」→「启用」全量;未启用态去徽标,只留「启用」链接
- [x] 保证行重写:「启用多语言后,文章地址不会改变;之后也可以随时安全地关闭。」
- [x] 弹窗守卫错误:专属文案 + 「添加 {语言}」一键修复按钮(响应带 language 字段)
- [x] zh 译文半角逗号/分号清理(AGENTS 新规范);3435 tests + lint + types 绿

## 结果

三件事全部落地。完整实现记录写入设计文档
`tasks/todos/2026-08-06-1758-multilingual-content.md` §19(含新规则表述:
「文章页的骨架属于它自己语言的站」)。本文件在提交后可删。
