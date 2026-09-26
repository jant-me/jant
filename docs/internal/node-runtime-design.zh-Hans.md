# Jant Node / Docker 运行时设计

状态：历史设计文档（部分内容已落地，当前实现已支持 Node + SQLite 与 Node + Postgres）

本文档定义 Jant 为 Node.js 裸机部署和 Docker 部署增加官方支持时的 v1 目标架构、公开 API、配置模型、实施顺序和文档范围。

## 1. 决策摘要

v1 采用以下方向：

- Node 运行时和 Docker 运行时共享同一套服务端实现，Docker 只是 Node 运行时的打包形式。
- 裸机 Node 和 Docker 都属于官方支持的部署路径。
- `@jant/core` 继续保留平台无关的 `createApp()`。
- Node 运行时的零配置启动入口是 `jant start`，屏蔽 `@hono/node-server` 等实现细节。`start()` 等函数在 `src/node/index.ts`，构建为 `dist/node.js` 供 CLI 使用，不在包的 `exports` 里（0.8.0 起），不属于公开 API。
- `createApp()` 保持无参数、无副作用；所有运行配置来自环境变量。
- `.env` 文件由 Node 官方 `--env-file` / `--env-file-if-exists` 处理，Jant 不重复实现 dotenv 解析。
- v1 采用混合命名策略：生态通用变量保持无前缀，Jant 专属变量使用 `JANT_` 前缀。
- v1 最初只计划支持 SQLite；当前实现已经支持 Node + SQLite 与 Node + Postgres。
- v1 新增本地文件存储驱动 `local`，语义对齐现有对象存储抽象；同时保留现有 `s3` 与 `r2`。
- v1 不为 Node / Docker 增加 `create-jant` 模板；`create-jant` 继续服务 Cloudflare 路线。
- v1 的默认自托管组合为：`SQLite + local media volume`。
- v1 的生产文档推荐组合为：`SQLite + S3-compatible storage`。

## 2. 背景与目标

当前 Jant 只正式支持 Cloudflare Workers。现有代码中：

- 应用初始化直接依赖 Workers 风格的 `c.env.DB.withSession()`。
- 鉴权和搜索直接依赖 `D1Database`。
- 存储已经有 `StorageDriver` 抽象，但只实现了 `r2` 和 `s3`。

这意味着 Node 支持的关键不是重写 routes / services，而是把“运行时装配”从 Workers 绑定里抽离出来，同时尽量复用现有的业务层、UI、路由和数据库 schema。

v1 目标：

- 支持在裸机 Node 24 上直接运行 Jant。
- 支持以 Docker image / compose 的方式部署同一套 Node 运行时。
- 保持 Cloudflare 路线继续可用。
- 让大多数用户通过 `jant start` 即可运行，不需要自己处理 Hono Node server、静态资源和 SQLite 初始化。

v1 原始非目标：

- Postgres（已不再适用，当前实现已支持）
- 多节点 / 多实例部署协调
- `create-jant --runtime=docker`
- 将 Node 路线拆成独立 npm 包
- 为所有存储后端都实现完整高级特性矩阵

## 3. 用户可见的部署模型

### 3.1 Cloudflare

继续保持现有工作流：

- `create-jant`
- `wrangler.toml`
- D1 + R2

### 3.2 裸机 Node

推荐工作流：

1. 安装 Node 24
2. 安装 `@jant/core`
3. 准备环境变量
4. 运行 `jant migrate`
5. 运行 `jant start`
6. 用 `systemd` 托管
7. 通过 Caddy / Nginx 做 TLS 与反向代理

### 3.3 Docker

推荐工作流：

1. 使用官方 Docker image
2. 挂载 SQLite 与 media volume
3. 通过 `env_file` 或容器环境变量注入配置
4. 由 entrypoint 自动执行迁移后启动

结论：

- Docker 不是单独产品形态，而是 Node 运行时的官方包装。
- 裸机 Node 和 Docker 必须共用同一套配置、命令和运行时代码。

## 4. 公开 API 设计

### 4.1 `@jant/core`

继续提供：

```ts
import { createApp } from "@jant/core";

const app = createApp();
```

约束：

- `createApp()` 无参数
- 不直接读取 `process.env`
- 不直接启动端口监听
- 不绑定 Node 或 Cloudflare 专有启动逻辑

### 4.2 Node 入口（`src/node/index.ts`）

Node 入口构建为 `dist/node.js`，由 CLI 通过 `bin/lib/load-node-runtime.js` 直接加载。它最初作为
`@jant/core/node` 发布，0.8.0 起从包的 `exports` 里移除：用户文档从未提到它，`jant start` 是公开的
启动方式，冻结一个没人用的入口只会增加 1.0 的承诺面。以后需要嵌入式启动时，再加回来即可（属于新增）。

`start()` 负责：

- 从环境变量创建 Node 运行时绑定
- 初始化 SQLite 连接
- 初始化本地或 S3 存储
- 配置 Hono Node server
- 挂载 `sitePathPrefix + "/_assets/*"` 静态资源
- 处理反向代理信任策略
- 启动 HTTP 服务

### 4.3 CLI

新增：

- `jant start`
- `jant migrate`

这两个命令内部直接复用 `dist/node.js`。

### 4.4 为什么不暴露 `@hono/node-server`

不让用户自己写：

```ts
import { serve } from "@hono/node-server";
```

原因：

- 这是 Jant 的实现细节，不是用户需要理解的公开接口。
- `start()` 应该把静态资源、反向代理、关闭信号和绑定初始化一起封装掉。
- 避免把“能跑起来”的职责拆给用户自己拼装。

## 5. 配置模型

Node / Docker 路线采用 env-only 模式。

原则：

- 所有配置都从环境变量读取。
- `.env` 文件加载由 Node 官方 `--env-file` 处理。
- Jant 不内置 dotenv。

### 5.1 `.env` 约定

推荐方式：

- 本地或裸机：`node --env-file=.env ...`
- 生产 `systemd`：`EnvironmentFile=/etc/jant.env`
- Docker：`env_file:` 或容器环境变量

### 5.2 变量来源

环境变量优先级由外部运行环境决定。Jant 只消费已经存在的环境变量值，不定义自己的 `.env` 合并规则。

### 5.3 v1 变量集合

生态通用变量：

- `NODE_ENV`
- `HOST`
- `PORT`
- `DATABASE_URL`

Jant 专属变量：

- `SITE_ORIGIN`
- `SITE_PATH_PREFIX`
- `AUTH_SECRET`
- `R2_PUBLIC_URL`
- `DEFAULT_THEME`
- `PAGE_SIZE`
- `SEARCH_PAGE_SIZE`
- `ARCHIVE_PAGE_SIZE`
- `UPLOAD_MAX_FILE_SIZE_MB`
- `SUMMARY_MAX_PARAGRAPHS`
- `SUMMARY_MAX_CHARS`
- `SLUG_ID_LENGTH`
- `RSS_FEED_LIMIT`
- `RSS_PUBLISH_DELAY_SECONDS`
- `IMAGE_TRANSFORM_URL`
- `STORAGE_DRIVER`
- `TRUST_PROXY`
- `DEV_API_TOKEN`
- `DEMO_*`
- `S3_*`
- `LOCAL_STORAGE_PATH`
- `LOCAL_PUBLIC_URL`

### 5.4 变量命名策略

由于项目尚未发布，v1 直接采用无前缀策略：

- 生态通用变量保持行业常见名称
- Jant 专属变量也统一使用无前缀名称

这样做的原因：

- `PORT`、`NODE_ENV`、`DATABASE_URL` 这类变量本来就是 Node / PaaS / 容器生态的事实标准
- Jant 主要面向单应用、自部署场景，直接使用 `SITE_ORIGIN`、`SITE_PATH_PREFIX`、`AUTH_SECRET`、`PAGE_SIZE` 这类名字更顺手
- 当前仓库同时支持 Cloudflare 与 Node 路线，统一无前缀能减少配置表、示例和调试说明之间的认知切换

结论：

- Node / Docker / Cloudflare 路线都按同一套无前缀命名
- 不保留带 `JANT_` 前缀的长期主路径
- 配置文档、示例文件和运行时解析保持同一契约

### 5.5 变量语义

`DATABASE_URL`

- Node 路线必填
- v1 只接受 SQLite 连接串
- 推荐格式为 `file:/absolute/path/to/jant.sqlite` 或 `file:./data/jant.sqlite`

`HOST`

- 默认 `127.0.0.1`

`PORT`

- 默认 `3000`

`TRUST_PROXY`

- 默认 `false`
- 为 `true` 时才信任 `X-Forwarded-*`
- 典型场景是应用运行在 Nginx / Caddy / Traefik 之后，且反代由站点所有者控制
- 若应用直接暴露到公网，或前置代理不受信任，则必须保持 `false`

作用：

- 正确识别公开协议（HTTP / HTTPS）
- 正确识别公开 Host
- 避免 TLS 终止发生在反代层时，应用误判自己处于明文 HTTP 环境
- 影响 secure cookie、绝对 URL、重定向目标和请求级公开 URL 推导

运维建议：

- 绑定到 `127.0.0.1` 或私网地址、前面挂 Nginx / Caddy 时，部署文档和示例配置推荐显式设置 `TRUST_PROXY=true`
- 直接对外监听时，文档推荐保持关闭
- 启动时如果检测到常见代理头但未开启 `TRUST_PROXY`，可以输出 warning，帮助用户排查 cookie / 重定向异常

不将默认值设为 `true` 的原因：

- 是否可信任 `X-Forwarded-*` 本质上是安全边界，不应猜测
- 默认信任代理头会让“直接暴露公网”的部署在无感知情况下接受伪造协议与主机信息
- 这会影响 secure cookie、绝对 URL 与重定向目标，风险高于少量显式配置成本

`LOCAL_STORAGE_PATH`

- 当 `STORAGE_DRIVER=local` 时必填
- 指向媒体文件根目录

`LOCAL_PUBLIC_URL`

- 可选
- 未设置时，媒体通过应用内 `/media/*` 路由代理
- 设置时，媒体 URL 直接指向该域名 / 前缀，语义与 `S3_PUBLIC_URL` / `R2_PUBLIC_URL` 保持一致

### 5.6 `STORAGE_DRIVER` 规则

扩展为：

- `r2`
- `s3`
- `local`

默认策略：

- Cloudflare 路线：保持当前默认 `r2`
- Node 路线：默认值设为 `local`，保证最少配置即可跑起来

文档建议：

- 快速开始文档：使用 `local`
- 生产部署文档：优先推荐显式设置 `STORAGE_DRIVER=s3`

原因：

- `local` 最适合 first boot 和单机试跑
- `s3` 更适合作为长期生产存储：更容易做对象级备份、迁移和 CDN 分发，也更容易与应用实例解耦

## 6. 运行时架构

### 6.1 总体策略

v1 继续复用 Drizzle 的 schema、迁移和大部分 CRUD 能力，但不再把 Cloudflare 的 `D1Database` 作为 Node 支持的目标抽象。

Node 支持的正确方向是：

- 保留 Drizzle 作为数据库 schema / ORM / migration 的统一基础
- 优先把现有 D1 专属调用收敛为运行时无关的 Drizzle 用法
- 仅在 FTS、snippet、原生命令等 Drizzle 不适合表达的场景保留一层 Jant 自己的内部原生查询接口
- Cloudflare 和 Node 分别实现该接口

原因：

- 当前确实有 `auth`、`search`、`createDatabase()` 直接依赖 `D1Database`
- 把所有问题都推给 D1 shim 虽然能跑，但会把 Cloudflare 运行时概念继续扩散到 Node 路线
- Jant 当初选择 Drizzle，就是为了共享 schema 与查询层，而不是把 D1 作为永久中心
- 即使加入 Postgres，也不应该把 Node 设计成“伪装成 Cloudflare”

### 6.2 目标边界

当前 `app.tsx` 中直接做了这些事：

- 配置校验
- 创建 DB session
- 创建 services
- 创建 storage
- 创建 auth

v1 需要把这部分整理成可复用的运行时装配逻辑。

建议新增内部模块：

- `src/runtime/bootstrap.ts`
- `src/runtime/cloudflare.ts`
- `src/runtime/node.ts`

职责：

- `bootstrap`：运行时无关的请求级初始化
- `cloudflare`：把 Workers bindings 转为通用 app 绑定
- `node`：把 `process.env` 与本地资源转为同一套 app 绑定

### 6.3 绑定类型

`src/types/bindings.ts` 当前是 Cloudflare 视角。v1 需要把它提升为“Jant 应用运行时绑定契约”。

要求：

- 保留 `DB`
- 保留现有 env 字段
- 允许 Node 路线不提供 `R2`
- 新增 `LOCAL_STORAGE_PATH`、`LOCAL_PUBLIC_URL`

注释和命名应从“Cloudflare Worker Bindings”调整为“Application runtime bindings”。

### 6.4 内部原生查询接口

新增一个仅在内部使用的原生查询接口，例如：

- `prepare()`
- `bind()`
- `run()`
- `all()`
- `raw()`
- `first()`
- `batch()`
- `exec()`
- `withSession()`

注意：

- 这不是新的主数据库抽象，更不是“D1 在 Node 上的公开替身”
- 该接口只用于原生 SQL 能明显更合适的场景，不应用于通用 CRUD
- `createDatabase()`、服务层的常规查询、better-auth 适配应尽量先改为依赖运行时无关的 Drizzle database
- Cloudflare 侧由真实 D1 适配
- Node 侧由 `better-sqlite3` 封装成异步接口来适配

这层接口主要服务于：

- 搜索服务中的 FTS、`snippet()` 等 SQLite 原生能力
- 少量批处理 / 原生命令
- 需要统一 async 调用风格的运行时装配

## 7. 数据库策略

### 7.1 v1 选择

当前 Node 路线支持：

- SQLite
- `better-sqlite3`
- Postgres

仍不支持：

- libsql
- 远程 SQLite 服务

### 7.2 Node 侧 SQLite 查询适配器

新增 Node 侧 SQLite 封装，实现 Jant 内部原生查询接口。

设计要求：

- 对上层暴露 Jant 自己的内部原生查询契约，而不是 Cloudflare 的 `D1Database` 类型
- `withSession()` 在 Node 下不实现复制一致性语义，直接返回同一连接上的 session wrapper
- `batch()` 模拟 D1 的事务性，失败时回滚
- 适配器只解决运行时 API 差异，不替代 Drizzle

Drizzle 在 Node 路线中的职责仍然是：

- 统一 schema
- 统一 migration
- 统一大部分 CRUD 查询
- 统一 better-auth 的表结构映射

重构方向：

- `createDatabase()` 改为返回运行时无关的 Drizzle SQLite database
- `createAuth()` 改为依赖该 Drizzle database，而不是 `D1Database`
- `search` 保留原生 SQL 路径，但依赖 Jant 的内部原生查询接口，而不是直接依赖 D1

### 7.3 迁移

Node 路线使用同一份 `src/db/migrations/`。

`jant migrate` 行为：

- 解析 `DATABASE_URL`
- 创建父目录
- 启用 `foreign_keys=ON`
- 启用 WAL
- 使用 Drizzle 的 SQLite migrator 执行迁移

### 7.4 FTS / trigram

当前搜索迁移依赖 SQLite FTS5 的 `trigram` tokenizer。

v1 策略：

- Node 运行时启动或迁移前执行能力检查
- 若缺少 FTS5 或 trigram，直接 fail fast，报出清晰错误
- 不在 v1 为生产运行时实现非 trigram 降级迁移分支

原因：

- append-only migration 体系不适合引入运行时分叉 SQL
- `better-sqlite3` 当前默认构建已能满足此要求
- fail fast 比隐式降级更符合 Jant 现有工程原则

## 8. 存储策略

### 8.1 目标

Node 路线的存储抽象继续复用现有 `StorageDriver`。

v1 支持：

- `local`
- `s3`

Cloudflare 继续支持：

- `r2`
- `s3`

### 8.2 为什么要支持 `local`

不只支持 `s3` 的原因：

- Docker / 裸机用户最自然的默认期望是单机磁盘存储
- `SQLite + local media` 是最顺手的自托管起点
- 对 Jant 这种单作者系统来说，这是合理的 v1 默认组合

### 8.3 `local` 驱动语义

`local` 驱动不模拟 S3 协议，而是模拟对象存储的应用语义：

- 使用相同的 key 结构：`media/YYYY/MM/uuid.ext`
- 实现与 `s3` / `r2` 同名方法
- 支持 `put/get/head/delete`
- 支持 multipart 接口

### 8.4 本地文件布局

在 `LOCAL_STORAGE_PATH` 下：

- 媒体文件：`<LOCAL_STORAGE_PATH>/media/YYYY/MM/...`
- 元数据 sidecar：`<filename>.meta.json`
- multipart 临时目录：`<LOCAL_STORAGE_PATH>/.multipart/...`

sidecar 至少包含：

- `contentType`

这样 `storage.get()` / `head()` 无需查询数据库即可正确返回内容类型和大小。

### 8.5 `LOCAL_PUBLIC_URL`

本地存储的公开 URL 规则与 S3/R2 保持一致：

- 未设置 `LOCAL_PUBLIC_URL`：走应用 `/media/*` 路由
- 设置 `LOCAL_PUBLIC_URL`：直接拼接为公开媒体地址

这允许后续通过 Nginx / Caddy / CDN 直接托管 media，而不要求应用自己代理。

### 8.6 multipart

当前 multipart 上传主要是为 Workers 的 100MB body limit 服务。

Node v1 需要把 multipart 从“R2 特性”改成“存储后端能力”：

- `local` 实现 multipart
- `r2` 保持 multipart
- `s3` 在 v1 先实现或补齐 multipart，避免大文件在 Node + S3 下退化

前端保持现有阈值逻辑，但不再假设只有 R2 支持 multipart。

## 9. Node 服务器行为

### 9.1 HTTP server

Node 入口内部使用 `@hono/node-server`。

公开 API 不暴露该依赖。

### 9.2 静态资源

Node 运行时需要自己提供 `sitePathPrefix + "/_assets/*"`：

- 资源目录来自包内 `dist/client`
- 与 Cloudflare 路线保持同样的 URL 约定

### 9.3 反向代理

Node 运行时需要明确 `TRUST_PROXY` 语义：

- `false`：只信任直接请求的 URL
- `true`：允许使用 `X-Forwarded-Proto`、`X-Forwarded-Host`

其用途：

- 计算公开请求 URL
- 正确决定 secure cookie
- 正确生成绝对 URL 与重定向地址

### 9.4 Cookie 与 `SITE_ORIGIN`

当前 secure cookie 与请求协议关联。Node 路线应改为更稳的策略：

- 优先基于可信代理后的公开协议
- 若无可信代理，基于直接请求
- `single-site` 下可继续使用 `SITE_ORIGIN` 作为固定公开基准 URL，并用 `SITE_PATH_PREFIX` 表达子路径部署
- `host-based` 下应以当前请求和匹配到的站点域名为准，不再把 `SITE_ORIGIN` 当作当前站点真相

## 10. CLI 与运维模型

### 10.1 v1 CLI 命令

新增：

- `jant start`
- `jant migrate`

后续补齐为运行时感知：

- `jant reset-password`
- `jant export`

Cloudflare 命令与 Node 命令可以共存，但需要按运行时模式分流实现。

### 10.2 运维建议

裸机 Node 文档要提供：

- `systemd` unit 示例
- Caddy 示例
- Nginx 示例
- 备份策略
- 升级策略

### 10.3 备份

Node / Docker 路线必须明确：

- 备份 `DATABASE_URL` 指向的 SQLite 文件
- 备份 `LOCAL_STORAGE_PATH`

这两者共同构成完整站点状态。

## 11. Docker 打包策略

### 11.1 v1 输出物

提供：

- 官方 Dockerfile
- 官方 image
- `compose.yaml` 示例
- `.env.example`

### 11.2 基础镜像

v1 使用 Debian 系镜像：

- `node:24-bookworm-slim`

不优先使用 Alpine，原因：

- `better-sqlite3` 的原生模块兼容性更稳
- 诊断和依赖行为更可预测

### 11.3 entrypoint

entrypoint 流程：

1. 运行迁移
2. 启动 `jant start`

### 11.4 volume

推荐挂载：

- `/var/lib/jant`

其中包含：

- `jant.sqlite`
- `media/`

## 12. 文档计划

### 12.1 更新现有文档

`README.md`

- 改成多部署目标总览
- 增加 Node / Docker 路线入口

`packages/core/README.md`

- 不再把平台表述成只有 Cloudflare
- 增加 `@jant/core/node`

`docs/deployment.md`

- 改为部署总览页

`docs/configuration.md`

- 从 Cloudflare 中心改为运行时中立
- 增加 Node / Docker 变量说明

### 12.2 新增文档

建议新增：

- `docs/deployment-cloudflare.md`
- `docs/deployment-node.md`
- `docs/deployment-docker.md`

Node 文档至少包含：

- 安装
- `node --env-file`
- `jant migrate`
- `jant start`
- systemd
- 反向代理
- 升级
- 备份

Docker 文档至少包含：

- `compose.yaml`
- 卷挂载
- 反向代理
- 升级
- 备份

### 12.3 `create-jant`

v1 不改 `create-jant` 的定位。

理由：

- Docker / Node 用户更需要“应用发行版”，不是“生成源码模板”
- 官方 image + compose + 文档更符合成熟自托管产品实践
- 先把运行时稳定下来，再评估是否需要源代码模板

## 13. 测试计划

### 13.1 单元 / 集成测试

新增或扩展测试覆盖：

- Node SQLite 原生查询适配器
- `local` storage driver
- Node 启动配置校验
- Node 静态资源服务
- Node 反向代理 URL 处理
- `jant migrate`
- `jant start`

### 13.2 回归测试

必须继续覆盖：

- 现有 Cloudflare 路线
- 现有 `r2` / `s3` 存储行为
- 鉴权流程
- 搜索
- 上传与大文件 multipart

### 13.3 Docker 验证

至少包含：

- Docker build smoke test
- compose 启动 smoke test
- SQLite + local media persistence smoke test

## 14. 分阶段实施

### 阶段 1：运行时解耦

目标：

- 把 `app.tsx` 中的 Cloudflare 专属初始化拆到内部运行时装配层
- 保持 Cloudflare 行为不变

主要改动：

- 提取 bootstrap 模块
- 绑定类型去 Cloudflare 专名化

### 阶段 2：Node 数据库与本地存储

目标：

- 实现 SQLite 原生查询适配器
- 实现 `local` storage driver
- 扩展 provider 配置与媒体 URL 计算

主要改动：

- `storage.ts`
- `types/bindings.ts`
- `types/config.ts`
- `resolve-config.ts`
- 数据库运行时适配模块
- schema / migration：增加 `local` provider

### 阶段 3：Node 启动入口与 CLI

目标：

- 提供 `@jant/core/node`
- 提供 `jant start`
- 提供 `jant migrate`

主要改动：

- Node 入口构建
- package exports
- CLI 命令
- 静态资源服务

### 阶段 4：部署与运维文档

目标：

- Node 裸机文档
- Docker 文档
- README / configuration / deployment 总览更新

### 阶段 5：剩余 CLI 与稳定性补足

目标：

- 让 `reset-password`、`export` 等命令具备 Node 路线支持
- 完整补上 Docker smoke test

## 15. 第一执行切片

建议按以下顺序开始实现：

1. 提取 `app.tsx` 中的请求级运行时装配逻辑
2. 把 `Bindings` / `AppConfig` 扩展到支持 `local` 与 `DATABASE_URL`
3. 实现 `local` storage driver
4. 实现 SQLite 原生查询适配器
5. 为 `search` / `auth` / `createDatabase` 在 Node 下跑通最小链路
6. 再增加 `@jant/core/node` 的 `start()`

原因：

- 先把运行时边界理顺，后面的 CLI 和 Docker 只是包装层
- 先打通 Node 最小请求链路，再做部署包装，验证更快

## 16. 需要保持的约束

实施中必须保持以下约束不变：

- 路由不直接访问数据库
- services 继续拥有所有业务逻辑
- schema migration 仍然 append-only，默认由 drizzle-kit 生成；少数
  Drizzle 无法表达的 schema 例外仍放在 `src/db/migrations/`
- 历史业务数据兼容继续走独立 backfill 轨道，由 `jant migrate` 串行执行
- `createApp()` 继续保持无参数
- Cloudflare 路线不能因 Node 支持而回退成功能次要路径
