# 备份与恢复

本文针对生产部署的备份与恢复策略。`@jant/core` 提供的导出/导入命令本身的语法、参数与归档结构请参阅 [导出与导入](export-and-import.md)。

一项核心约束：**完整的 Jant 备份必须同时覆盖数据库与媒体存储**。缺数据库则丢 post、collection、setting 与媒体元数据；缺媒体则保留指向文件的记录但失去文件本身。两者均不可独立恢复站点。

完整备份覆盖以下几层：

- **内容**：`post` / `collection` / `nav_item` / `path_registry` / 媒体记录
- **配置**：`site_setting`
- **认证**：`user` / `session` / `account` / `api_token` / `verification`
- **二进制**：上传的媒体文件本身（本地目录或 S3 兼容 bucket）

## 选择合适的工具

| 需求                     | 使用                                            |
| ------------------------ | ----------------------------------------------- |
| 跨 Jant 站点迁移内容     | `site export` / `site import`                   |
| 按原样恢复 ID 与存储 key | `site snapshot export` / `site snapshot import` |
| 应对生产环境数据丢失     | 数据库备份 + 媒体备份                           |

`site export` 与 `site snapshot` 都是内容层备份，不替代底层数据库与对象存储自身的备份方案。

下文命令默认走自动推导（本地 D1 或 Node 运行时）。生产环境请显式传入 `--remote` / `--node`，标志语义与环境变量见 [导出与导入 § 运行环境](export-and-import.md#运行环境) 与 [配置](configuration.md)。

## site snapshot

Snapshot 与底层部署解耦，可作为跨环境的恢复归档使用。下例分别对应自动推导（D1 或 Node，按环境变量决定）与远端 Cloudflare D1：

```bash
mkdir -p backups
npx jant site snapshot export --output ./backups/jant-site-snapshot-$(date +%F).zip
npx jant site snapshot export --remote --config ./wrangler.toml --output ./backups/jant-site-snapshot-$(date +%F).zip
```

Node + Postgres 部署应显式指定目标，避免依赖自动推导：

```bash
DATABASE_URL=postgres://... npx jant site snapshot export --node --output ./backups/jant-site-snapshot-$(date +%F).zip
```

恢复必须显式传 `--replace`：

```bash
npx jant site snapshot import --path ./backups/jant-site-snapshot-2026-03-30.zip --replace
npx jant site snapshot import --remote --config ./wrangler.toml --path ./backups/jant-site-snapshot-2026-03-30.zip --replace
```

不传 `--replace` 时命令直接拒绝，避免误覆盖。`--replace` 会清空目标库中内容范围的表后写入归档（`post`、`collection`、`nav_item`、`collection_directory_item`、`thread_collection`、`media`、`path_registry`），但不动 `user` / `session` / `api_token` 等认证表。归档结构、`--skip-objects`、`--allow-missing-objects` 等选项详见 [导出与导入 § 站点快照](export-and-import.md#站点快照site-snapshot)。

## Docker 与 Node

### Docker Compose 默认布局

仓库自带的 `compose.yml` 把本地数据存放于：

- `data/jant.sqlite`
- `data/media/`

直接归档运行中的 SQLite 文件可能产生不一致快照。先停服务再打包：

```bash
docker compose down
mkdir -p backups
tar -czf ./backups/jant-full-$(date +%F).tar.gz data/jant.sqlite data/media
docker compose up -d
```

恢复时先清旧数据——`tar -xzf` 只覆盖同名文件，旧 `data/media/` 里多出来的对象会留下，造成脏数据：

```bash
docker compose down
rm -rf data/jant.sqlite data/media
tar -xzf ./backups/jant-full-2026-03-30.tar.gz
docker compose up -d
```

### Bare Node + SQLite + 本地媒体

默认布局下，SQLite 文件位于 `DATA_DIR`（默认 `./data`），媒体目录为 `LOCAL_STORAGE_PATH`（默认 `<DATA_DIR>/media`）。停止进程管理器后归档实际配置的路径：

```bash
set -a; source .env; set +a   # 加载 DATA_DIR / LOCAL_STORAGE_PATH
mkdir -p backups
tar -czf "./backups/jant-full-$(date +%F).tar.gz" \
  "${DATA_DIR:-./data}/jant.sqlite" \
  "${LOCAL_STORAGE_PATH:-${DATA_DIR:-./data}/media}"
```

如果 `DATABASE_URL` 显式覆盖了 SQLite 路径（例如 `DATABASE_URL=file:/var/lib/jant/custom.sqlite`），归档对象应跟随 URL 中的路径。

### Node + Postgres

```bash
set -a; source .env; set +a
mkdir -p backups
pg_dump "$DATABASE_URL" > ./backups/jant-db-$(date +%F).sql
```

仍使用本地媒体存储时，单独归档 `LOCAL_STORAGE_PATH` 指向的目录（默认 `<DATA_DIR>/media`）：

```bash
tar -czf ./backups/jant-media-$(date +%F).tar.gz data/media
```

恢复前先停 Jant 进程，并确保目标库为空——`pg_dump` 默认不含 `CREATE DATABASE`，必要时先 `dropdb && createdb`；并发写入会损坏正在恢复的库：

```bash
psql "$DATABASE_URL" < ./backups/jant-db-2026-03-30.sql
```

### Node + S3 兼容存储

媒体托管于 S3、Backblaze B2、MinIO、Cloudflare R2 或其他 S3 兼容对象存储时，备份分为数据库与对象两部分。

Jant 运行时使用 `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` 等变量，AWS CLI 使用 `AWS_*` 凭据链或 `~/.aws/credentials`，两者**不会互通**——备份脚本需要为 AWS CLI 单独提供凭据，或用 `--profile` 指定一个预配置 profile。

```bash
set -a; source .env; set +a
mkdir -p backups

# 数据库
pg_dump "$DATABASE_URL" > ./backups/jant-db-$(date +%F).sql

# 对象（AWS S3）
aws s3 sync "s3://$S3_BUCKET" "./backups/media-$(date +%F)/"

# 对象（S3 兼容服务，如 R2、B2、MinIO）
aws s3 sync "s3://$S3_BUCKET" "./backups/media-$(date +%F)/" \
  --endpoint-url "$S3_ENDPOINT" \
  --profile your-s3-compatible-profile
```

反向恢复（把本地副本写回 bucket）：

```bash
aws s3 sync "./backups/media-2026-03-30/" "s3://$S3_BUCKET"
```

如果 bucket 已开启版本控制，**优先走控制台还原**——`aws s3 sync` 默认不带 `--delete`，但任何后续误操作都可能把本地副本中的「缺失」传播到线上。生产环境也优先使用对象存储自身的版本控制或跨区域复制，本地 sync 仅作为离线副本补充。

## Cloudflare Workers

D1 + R2 部署的备份策略应分两层：

1. **平台外副本**：定期导出 SQL 与 snapshot，确保平台层故障时仍持有可恢复归档。
2. **平台内恢复**：D1 的 time-travel / point-in-time restore，以及 R2 的 lifecycle 与跨桶复制策略。

平台外副本通过 `--remote` 调用，目标 D1 与 R2 binding 从 `wrangler.toml` 读取（脚本化场景下用 `--config` 指定具体文件）：

```bash
mkdir -p backups
npx jant db export --remote --config ./wrangler.toml --output ./backups/jant-db-$(date +%F).sql
npx jant site snapshot export --remote --config ./wrangler.toml --output ./backups/jant-site-snapshot-$(date +%F).zip
```

`--remote` 经由 `wrangler` CLI，因此当前 shell 必须已通过 `wrangler login` 完成认证，或设置了 `CLOUDFLARE_API_TOKEN`。

`db export` 提供独立的数据库 SQL，`site snapshot export` 提供包含被引用对象的内容归档。两者均不替代 D1 的恢复流程，也不替代 R2 的对象保留策略。

## 恢复清单

### Cloudflare

1. **数据库**：用 `wrangler d1 execute <db> --file=./backups/jant-db-*.sql --remote` 灌回 SQL，或用 D1 time-travel 回滚；snapshot 用 `npx jant site snapshot import --remote --replace`。
2. **对象**：缺失对象从 R2 版本控制或离线副本补齐。
3. **部署**：binding 没变不用重新部署；换了 D1 / R2 才需更新 `wrangler.toml` 重新部署。
4. **验证**：首页、collection 页、媒体 URL、setting 页。

### Docker 或 Node

1. 停止应用。
2. 恢复数据库文件或数据库服务（参考上文对应章节的 `psql < ...` 或 `tar -xzf`，注意先清旧数据）。
3. 恢复媒体文件或媒体 bucket。
4. 启动应用。
5. 验证 post、collection、上传与 feed。

## 恢复演练

在 staging 环境执行至少一次完整恢复，记录 RPO（可接受的数据丢失量）与 RTO（可接受的恢复耗时）。

演练步骤：

1. 在干净环境恢复数据库。
2. 恢复媒体。
3. 启动 Jant。
4. 打开首页、setting 页与若干样本 post URL。
5. 验证附件与 collection 页。
6. 记录耗时与丢失量，对照 RPO / RTO 调整方案。

未在空白环境完整验证过的备份不算可用备份。

## 接下来

- [导出与导入](export-and-import.md) —— 导出/导入命令的语法、flag 与归档结构
- [自动化与 API](automation-and-api.md) —— 备份脚本化与定时执行
- [GitHub 同步](github-sync.md) —— 内容层的 Git 历史副本
