# 导航标签跟随目标 + 语言视图解析翻译版本

日期：2026-08-13
起因：双语站点在 `/en` 视图里，指向 About 页的导航项仍然指着主语言那篇，
标签也是主语言的。读者从 `/en` 进来点 About 会掉进中文内容。

## 决定

沿用代码库里已有的约定（`ui/shared/navigation-labels.ts` 对 system 项的处理）：

- `nav_item.label` 只存**覆盖值**。空字符串 = "跟随目标"。
- 跟随的来源按类型分：system → i18n 文案（已实现）、page → 目标文章标题、
  collection → 合集标题、link → 无（label 必填）。
- 语言视图里，page 型导航项解析到同翻译组中该语言的版本；没有该版本就退回
  原来那篇（标签也一并退回，链接落在哪种语言，标签就是哪种语言）。

不做：导航按语言分表（`nav_item.language`）。骨架共用一份是设计文档原则 4，
本次只让**目的地和它的标题**跟着读者走，不动骨架规则。

不做（本轮）：`/en/{slug}` 入口跳翻译组。作者明确说暂缓。

## 收益

- 不再有 label 快照，改页面标题导航自动跟上（这是本来就漏掉的同步，
  `url` 早就在 `services/post.ts` 里同步了，`label` 没有）。
- 没有缓存就没有失效：不用在 post.update 里加分支，import/export/GitHub sync
  这些绕过 service 的路径也不会漏同步。
- 无需 schema 变更：`label` 保持 NOT NULL，`''` 已经是哨兵值。

## 任务

- [x] 1. `types/entities.ts` / `types/views.ts`：`NavItem`、`NavItemView` 加 `targetTitle`
- [x] 2. `services/navigation.ts` `normalizeCreateData`：page / collection 不再预填标题
- [x] 3. `services/navigation.ts` `list()`：LEFT JOIN 取目标实时标题
- [x] 4. `services/navigation.ts` `list({ language })`：page 项解析翻译组兄弟篇
- [x] 5. `services/navigation.ts` `update()`：page / collection 允许清空标签
- [x] 6. `routes/api/nav-items.ts`：collection 分支的 label/url 派生下沉到 service
- [x] 7. `lib/navigation.ts`：把视图语言传进 `list()`，仅在非主语言视图传
- [x] 8. `lib/view.ts`：`targetTitle` 透传到 `NavItemView`
- [x] 9. `ui/shared/navigation-labels.ts`：`getNavItemDisplayLabel` 加 targetTitle 兜底
- [x] 10. `services/export.ts`：`resolveNavItemLabel` 同步这套优先级
- [x] 11. backfill：存量 label 等于目标当前标题的置为 `''`
- [x] 12. 测试 + `check-tests` / `check-lint`

## 实现记录

### 改动

**标签语义**

- `NavItem` / `NavItemView` 加 `targetTitle`：目标行的实时标题，读取时 join 得到。
- `services/navigation.ts` 新增 `selectNavItemsWithTargets()`：nav 行 LEFT JOIN
  `post` 和 `collection`（都按主键），`list()` / `getById()` / `readNavItem()`
  共用。查询次数不变。
- `normalizeCreateData` 的 page 与 collection 分支不再把标题写进 `label`；
  作者没输入就是 `''`。
- `update()` 只对 `link` 型要求非空标签 —— 清空是「交还给目标」的操作。
- `getNavItemDisplayLabel` 优先级：存的 label → 内置 i18n 文案 → `targetTitle`。
- `routes/api/nav-items.ts` 的 collection 分支不再自己派生 label/url，下沉到
  service（顺带修掉一处路由里的业务逻辑）。missing collection 仍返回 404。
- 客户端 `jant-nav-manager`：mutation 响应用 `targetTitle` 兜底 displayLabel；
  page / collection 的标签输入去掉 `required`，placeholder 显示实时标题。
- `services/export.ts:resolveNavItemLabel` 跟上同一套优先级。

**语言视图解析**

- `list({ language })`：page 型 nav 项按翻译组查该语言的版本，命中就换
  `url` + `targetTitle`，`postId` 不动（它是这条 nav 配置的目标身份）。
  兄弟篇要满足和加入导航时同样的条件（published、非 private、有标题）。
- `getNavigationData` 只在 `langBase` 非空（即非主语言视图）时传 language，
  所以整个主语言站点一次额外查询都不付。
- 语言视图下多一次查询，走 `uq_post_site_translation_group_language`
  这个既有唯一索引。（原先设想是自连接塞进同一条语句，实测需要 dialect
  专属的 `alias()` 导入，双方言 schema bundle 下不划算，改成第二条查询。）

**存量数据**

- `db/backfills/0006_clear_mirrored_page_nav_labels.sql`：label 等于目标当前
  标题的置空，被自定义过的保留。无 schema 变更（`''` 早就是 system 项的哨兵）。

### 验证

- `mise run check-tests`：265 files / 3461 tests 全部通过，exit 0。
  （中途一次运行里 `demo-canonical-snapshot` 与 `migration-rehearsal` 被
  vitest pool 的 teardown 超时掐断过，两者单独跑 2 passed / 83s；最终整跑
  未复现。）
- `mise run check-lint`：clean。
- 新增测试：
  - `services/__tests__/navigation.test.ts` — 语言视图解析 5 例（命中、
    无该语言退回、草稿/私密不算、自定义标签跨视图保留、不传 language 不解析）
    ＋「改标题导航跟着改」。
  - `routes/pages/__tests__/language-routing.test.ts` — 端到端三例：`/en` 的
    导航指向 `/about-en` 且写作 About，`/` 保持 `/about` 与「关于」，
    没有英文版时链接与标签一起退回主语言。
  - `db/__tests__/backfill-nav-label-mirrors.test.ts` — 0006 backfill 四例，
    含重复执行安全。
- 改动的既有测试：`nav-items.test.ts`（label 快照 → `''` + `targetTitle`）、
  `navigation.test.ts`（截断改测自定义标签）、`post.test.ts`（改名同时验证
  URL 写时同步、标题读时跟随）。
