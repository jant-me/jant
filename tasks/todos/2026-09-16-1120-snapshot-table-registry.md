# 修复快照工具链的表登记缺口

## 根因

`SNAPSHOT_TABLES` / `SNAPSHOT_CLEAR_TABLES` 是 `packages/core/bin/lib/site-snapshot.js`
里两个手写的字符串数组，和 `src/db/schema.ts` 之间没有任何连接。`bin/` 是纯 JS，
在 TypeScript 类型系统之外 —— 加一张新的 site-scoped 表时，编译器不报错、测试不红、
lint 管不到，漏登记是静默的。

引入 `smart_collection` 的提交 `6681ee96`（2026-08-21）改了 schema、pg schema、
5 个 service、1 个 route、3 个测试，唯独没碰 `site-snapshot.js`。

两个数组的**顺序**还各自承载隐性语义（= INSERT 顺序 / DELETE 顺序），必须符合外键
拓扑，但没有注释、没有测试、没有推导。

## 根因的旁证：三份清单，改对了两份

追查 content-lab 时发现仓库里一共有三份手写的内容表清单，而 `6681ee96`
（引入 `smart_collection` 的那个提交）更新了其中两份：

| 清单 | 位置 | 有 smart_collection |
|---|---|---|
| `buildSiteContentResetSql` | `scripts/lib/remote-site-ops.mjs` | 有，还带 FK 顺序注释 |
| content-lab 导出的 `tables` | `sites/content-lab/scripts/export-content-lab.mjs` | 有 |
| `SNAPSHOT_TABLES` / `SNAPSHOT_CLEAR_TABLES` | `packages/core/bin/lib/site-snapshot.js` | **没有** |

作者不是粗心 —— 他更新了手边那两份。漏掉的那份没有任何东西连着它。
第一轮的 guard 测试只守住了第三份（它在 `packages/core` 里，测试够得到）。
另外两份在仓库脚本层，已由 `scripts/check-site-tables.mjs` 补上（见下）。

## 当前的两个实例

1. **`smart_collection` 完全缺失**
   - 导出静默跳过 → 在 demo-source 建的智能合集进不了快照
   - `--replace` 清不掉 → 访客在 demo 建的永久存活
   - 相关外键列被清空但行不删 → 留下无 slug、无导航入口的孤儿
   - Hugo 的 `site export`/`import` 路径同样零处理（本次不改，单独记录）

2. **插入顺序违反外键**：`nav_item` 排在 `post` 前，但 `nav_item.post_id → post.id`。
   现在没炸是因为 demo 的 5 条导航全是 `type='system'`，FK 列全 NULL。
   加一条 `type='page'` 导航项就会当场失败。

两个都是静默的：跑多少次导入导出都不报错，要等数据形状变了才暴露。

## 从 schema 推导出的真实依赖

```
site_setting               -> []
collection                 -> []
smart_collection           -> []        （collection_id 没有 .references()，不是 FK）
post                       -> []        （只有自引用 replyTo / thread）
thread_collection          -> [post, collection]
nav_item                   -> [collection, smart_collection, post]
collection_directory_item  -> [collection, smart_collection]
path_registry              -> [post, collection, smart_collection]
media                      -> [post]
```

FK 是真强制的：`bin/lib/node-sqlite.js:145` 有 `pragma("foreign_keys = ON")`，
D1 默认也强制，测试用的 `createTestDatabase()` 同样开着。

## 任务

- [x] `site-snapshot.js`：新增 `SNAPSHOT_EXCLUDED_TABLES`，逐张写明排除理由
- [x] `site-snapshot.js`：`SNAPSHOT_TABLES` 补 `smart_collection` 并按拓扑重排
- [x] `site-snapshot.js`：`SNAPSHOT_CLEAR_TABLES` 同上（反向，子表先删）
- [x] 新增 `src/__tests__/snapshot-tables.test.ts`（guard 测试）
      - 每张 site-scoped 表必须显式出现在两个清单之一
      - `SNAPSHOT_TABLES` 顺序符合 FK 拓扑
      - `SNAPSHOT_CLEAR_TABLES` 顺序符合反向拓扑，且覆盖 `SNAPSHOT_TABLES` 去掉
        `site_setting`（后者由 `SNAPSHOT_SETTING_KEYS` 单独按 key 清）
- [x] 新增 `src/__tests__/snapshot-canonical-replay.test.ts`
      - 用 `createTestDatabase()` 建一个迁移到 head 的库
      - 重放已提交的 `canonical/snapshot/db.sql`（先 `buildReplaceSql`）
      - 断言不抛错 —— 把「凌晨三点静默失败」变成「PR 变红」
- [x] `reset-demo.yml` / `migration-rehearsal.yml`：失败时通知（现在两个都没有）
- [x] 修文档：`sites/demo-source/README.md` 两处与代码不符
      - 声称 push 到 main 自动部署（实际只有 `workflow_dispatch:`）
      - 声称 site-export 派生自已提交快照（实际打实时 Worker，要 `JANT_API_TOKEN`）

## 不在本次范围

- 给 demo / demo-source 加自动部署（Owen 待会儿手动部署，之后再定）
- Hugo `site export`/`import` 对 smart_collection 的支持
- demo 迁移到 Docker
- demo-source 的 NOINDEX

## 验证

- `mise run check-tests`：新测试必须先红（证明抓得到），补完 `smart_collection` 后转绿
- 重放测试对**当前已提交的**快照要通过（它是 0033 之前导的，验证向前兼容）

## 实施中新发现的第三处

`SELECT_SQL_BY_TABLE` 没有默认分支 —— 列进 `SNAPSHOT_TABLES` 却没有对应 SELECT
语句的表，会在导出时抛 `Unsupported snapshot table`。和注册表本身一样，是
「列上了才炸」的静默失败。已一并补 `smart_collection` 的语句，并加断言覆盖。

## 结果

`site-snapshot.js`

- `SNAPSHOT_TABLES` 按外键拓扑重排并补 `smart_collection`：
  `site_setting, collection, smart_collection, post, thread_collection,
   nav_item, collection_directory_item, path_registry, media`
- `SNAPSHOT_CLEAR_TABLES` 同步重排（子表先删）
- 新增 `SNAPSHOT_EXCLUDED_TABLES`，9 张表逐条写明排除理由
- 新增 `smart_collection` 的导出 SELECT

`src/__tests__/snapshot-tables.test.ts`（7 个断言）

- 每张 site-scoped 表必须登记在两个清单之一
- 不能同时出现在两个清单
- 不能有 schema 已删除的残留条目
- `SNAPSHOT_TABLES` 里每张表都要有可用的导出 SELECT
- 插入顺序符合 FK 拓扑
- 删除顺序符合反向拓扑
- `SNAPSHOT_CLEAR_TABLES` 恰好覆盖内容表减去 `site_setting`

`src/__tests__/snapshot-canonical-replay.test.ts`（3 个断言）

- 已提交快照能重放进迁移到 head 的库
- 连续重放两次（模拟每晚重建，验证删除顺序）
- 每张内容表的导出 SELECT 能在真实 schema 上执行

`report-failure.yml` + 两个 workflow 接线

- 复用型 workflow，用默认 `GITHUB_TOKEN` 开 issue，同一故障复发追加评论不刷屏
- `reset-demo.yml`：`if: failure()`
- `migration-rehearsal.yml`：`if: failure() && github.event_name != 'pull_request'`
  （PR 失败已有红勾，不需要再开 issue）

## 验证

- 新测试先红，精确报出两个 bug，无误报：
  `expected [ 'smart_collection' ] to deeply equal []`
  `expected [ 'nav_item (2) references post (4)' ] to deeply equal []`
- 反向验证过三次，确认测试不是空壳：
  - `createTestDatabase()` 确实强制外键（`type='page'` 指向不存在的 post 会抛）
  - 故意把 SELECT 的 ORDER BY 改成不存在的列 → 测试变红
- `mise run check-tests`：321 文件 / 4388 测试全绿（含 check-types、check-lint）
- `mise run check-copy`：47 文件 0 错 0 警
- 两个方言 schema 表集合一致，`smart_collection` 两边都有 → 只读 sqlite schema 足够

## 交给 Owen 的后续

1. 手动部署 demo-source 和 demo
2. `mise run demo-source-export-canonical` 重新导出快照并提交
   —— 这次会第一次带上 `smart_collection`（当前为 0 行）
3. 之后重放测试守的就是新快照

## 遗留

### 已在后续一轮解决

- **content-lab 的 NOINDEX**：同样的问题，同样的一行修复。它是个挂在 jant.me
  子域上、标题叫 `test-content-lab` 的暂存站，此前 `Allow: /` 且发布 sitemap。
  已确认库里没有 `NOINDEX` 设置行。
- **demo-source 的 NOINDEX**：`sites/demo-source/wrangler.toml` 设 `NOINDEX = "true"`。
  它会同时给页面加 `noindex, nofollow` meta，并把 robots.txt 翻成 `Disallow: /`
  （`routes/feed/sitemap.ts:318`）。已确认 demo-source 库里**没有** `NOINDEX`
  设置行，所以 env 生效 —— 但 `NOINDEX` 的优先级是 DB > ENV，将来在 Settings 里
  关掉会盖过它，注释里写明了。
  README 里「private authoring site」的说法也改了：private 指的是谁能写，不是谁能读。
- **提交进仓库的本地绝对路径**：7 个文件全部修完，32 个本地链接验证全部指向真实文件。
  `docs/internal/agent-automation-testing.md` 里那三处是可执行命令，改成了
  `REPO_ROOT=$(git rev-parse --show-toplevel)`，不是简单替换成相对路径。
- **`sites/content-lab/README.md` 的第三处假话**：和 demo-source 一样声称 push 到
  main 自动部署，实际 `deploy-content-lab.yml` 只有 `workflow_dispatch:`。

### 仍未处理

- **Hugo `site export`/`import` 对 `smart_collection` 零处理**，见下节。
- demo / demo-source 的自动部署。
- demo 迁移到 Docker（另一份任务文件）。

## Hugo 导出路径的 smart_collection 缺口（已调研，待决策）

「Hugo 没有 smart collection 概念」不是理由 —— 导出格式里的 `data/jant.toml`
已经在承载 `[[nav]]` 和 `[[directory]]`，这两个 Hugo 同样没有。它是个
Jant 专属 sidecar（`format = "jant-site"`, `version = 1`）。

实际行为（`services/export.ts`，全文件零处 `smartCollection`）：

| 东西 | 现在会怎样 |
|---|---|
| 智能合集本身 | 完全不导出，Hugo 站点里没有对应页面 |
| 它的目录条目 | `buildExportedCollectionDirectoryItems` 走到最后的 `item.collection` 分支，而 `smart_collection` 类型的 `collection_id` 被 CHECK 约束为 NULL → **静默丢弃** |
| 它的导航条目 | `resolveNavItemUrl` 落到 `item.url`，导出成一条在生成站点里 404 的链接 |

为什么值得处理：`docs/faq.md:124` 把 export → import 列为**推荐**的
hosted ↔ 自部署迁移方式。在这条路上静默丢用户数据，和刚修的快照 bug 是同一类。

三档可选，需要 Owen 定：

1. **只保往返**（最小）：在 `data/jant.toml` 里带上智能合集定义，让 `site import`
   能还原；导航条目不要导成 404 链接。迁移不丢数据，但导出的 Hugo 站点仍缺页面。
2. **加上静态物化**：智能合集是个保存下来的查询，导出是静态快照 —— 可以像合集页那样
   把查询结果物化成静态列表页。导出的站点就完整了。
3. **目录条目也渲染**：配合 1 或 2。

这是一个 feature 尺寸的改动，不该顺手塞进本次。

## 第三轮：仓库级表清单检查

`packages/core` 的 vitest 够不到 `scripts/` 和 `sites/`，而反向依赖（core 的测试
去 import 仓库脚本）方向别扭。所以做成仓库级脚本，挂在 `check-ci` 的 Phase 1。

**分层**：`SNAPSHOT_TABLES` 是唯一的登记处，vitest 把它锚在 schema 上；
`check-site-tables.mjs` 再把另外两份锚在它上面。新增内容表只需登记一次，
三份清单都会被推着跟上。

**三份清单不一样，也不该一样**，所以差异是声明出来的而不是抹平的：

| 清单 | site_setting | api_token |
|---|---|---|
| `SNAPSHOT_TABLES` | 有 | 无（凭据不进可移植快照） |
| `buildSiteContentResetSql` | 无 | 可选 |
| `buildContentLabExportQueries` | 无 | 有（演练 fixture 需要） |

脚本里用 `SNAPSHOT_ONLY` 和 `EXTRA_ALLOWED` 两个声明表达，后者每条要写理由。

**检查项**：覆盖（`SNAPSHOT_TABLES` 的内容表不能缺）、无未知表（不能出现
schema 里不是 site-scoped 的表）、未登记的额外表要有理由、无重复、
外键顺序（导出清单是插入序，reset 是删除序）。

**配套重构**：`sites/content-lab/scripts/export-content-lab.mjs` 在模块顶层就
`resolveSingleRemoteSite()`（会调 wrangler），没法被 import。把查询目录抽成
无副作用的 `sites/content-lab/scripts/export-queries.mjs`，检查脚本直接 import，
不做静态解析。抽取前后用旧版文件对拍过，9 张表的 SQL 逐条一致。

### 验证

四个反向测试，全部命中：

| 破坏 | 结果 |
|---|---|
| content-lab 清单删掉 `smart_collection` | 报 missing |
| reset SQL 删掉 `smart_collection` | 报 missing |
| 把 `nav_item` 移到 `post` 前 | 精确报出 3 处外键违约 |
| 清单里放重复条目 | 报 duplicate |

第三项一开始**没抓到** —— 我最初用「复制」而不是「移动」来制造顺序错误，而
`new Map(tables.map(...))` 只保留最后一次出现的下标，重复项把顺序错误盖住了。
这是脚本的真 bug，因此补了重复检测，重测通过。

`check-lint`、`check-format`、`check-tests`（322 文件 / 4394 测试）全绿。

## 第四轮：修正上一轮的一个错误

重新导出的快照（`9427684c`）里表的出现顺序仍是旧的，我一度以为是「用了未更新的
checkout 导的」。**这个判断是错的**，真实原因更要紧：

`bin/lib/sql-export.js` 里的 `TABLE_EXPORT_ORDER` 是**第五份**手写有序清单，而
`dumpDatabaseToSql` 会用 `sortExportTables()` 拿它重排调用方给的表。所以决定 dump
顺序的从来不是 `SNAPSHOT_TABLES`，是它。

后果，以及第一轮修复的实际有效范围：

| 第一轮改的 | 是否生效 |
|---|---|
| `SNAPSHOT_TABLES` **成员**（补 `smart_collection`） | 生效 —— 决定哪些表被读 |
| `SNAPSHOT_TABLES` **顺序** | **失效** —— 被 `sortExportTables` 覆盖 |
| `SNAPSHOT_CLEAR_TABLES` 顺序 | 生效 —— `buildReplaceSql` 直接用 |

而 `TABLE_EXPORT_ORDER` 自己带着两个问题，和第一轮修的是同一对：

- **没有 `smart_collection`**。未登记的表在 `sortExportTables` 里排到所有已知表
  **之后**，所以一旦有智能合集，它会被 dump 到 `nav_item`、
  `collection_directory_item`、`path_registry` 之后 —— 这三张都引用它 → 导入外键违约。
- `nav_item` 排在 `post` 前面。

### 改动

- `TABLE_EXPORT_ORDER` 补 `smart_collection`（`collection` 之后、三张引用它的表之前），
  并把 `nav_item` 移到 `post` 之后。它同时服务 `jant db export`，那条路一并修好。
- 导出 `TABLE_EXPORT_ORDER`，让测试够得到。
- guard 测试改成断言 **`sortExportTables(SNAPSHOT_TABLES)` 的结果**，而不是原数组；
  另加一条断言：每张内容表都必须登记在 `TABLE_EXPORT_ORDER` 里。
- 修正 `SNAPSHOT_TABLES` 的文档注释 —— 它此前声称自己的顺序是导入顺序，不实。

### 验证

| 破坏 | 结果 |
|---|---|
| `TABLE_EXPORT_ORDER` 移除 `smart_collection` | 两条断言同时红（未登记 + 3 处外键违约） |
| `nav_item` 退回 `post` 之前 | 精确报 `nav_item (3) references post (4)` |

`check-site-tables`、`check-tests`（322 文件 / 4395 测试）全绿。

### 对已提交快照的影响

当前快照在 0 个智能合集下能正常加载（重放测试通过），但它是用坏的 dump 顺序导出的。
**修复后需要再导出一次**，让提交进仓库的那份带上正确顺序。
