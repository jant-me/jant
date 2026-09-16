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

## 遗留（已记录，不在本次范围）

- Hugo `site export`/`import` 对 `smart_collection` 零处理
- 另外 7 个 markdown 文件里有提交进仓库的本地绝对路径 `/Users/green/project/jant/...`：
  `CONTRIBUTING.md`、`docs/internal/markdown-contract.md`、
  `docs/internal/site-aware-core-implementation-plan.md`、
  `docs/internal/agent-automation-testing.md`、`tasks/github-app-installation-index.md`、
  `sites/demo/docs/internal/operations.md`、`sites/content-lab/README.md`
- demo / demo-source 的自动部署
- demo-source 没有 NOINDEX，且公开可读
