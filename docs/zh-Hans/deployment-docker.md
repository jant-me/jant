# 使用 Docker 部署

官方镜像 [`owenyoung/jant`](https://hub.docker.com/r/owenyoung/jant) 运行 Node 版本的 Jant，启动前会自动跑数据库迁移。

## 开始前

你需要准备：

- [Docker](https://docs.docker.com/engine/install/) 和 [Docker Compose](https://docs.docker.com/compose/install/)
- 一个足够长、足够随机的 `AUTH_SECRET`，可以用 `openssl rand -base64 32` 生成

## 用 Docker Compose 快速开始

建一个目录用来放站点的配置和数据，然后下载官方 Compose 文件：

```bash
mkdir jant-site && cd jant-site
curl -O https://raw.githubusercontent.com/jant-me/jant/main/compose.yml
curl -o .env https://raw.githubusercontent.com/jant-me/jant/main/.env.example
```

编辑 `.env`，把 `AUTH_SECRET` 换成实际生成的密钥：

```env
AUTH_SECRET=<auth-secret>
```

启动：

```bash
docker compose up -d
```

打开 `http://127.0.0.1:3000`，首次访问会引导你创建管理员账号。如果端口被占用，在 `.env` 里设 `HOST_PORT=8080`（或别的）。

## 默认 Compose 里有什么

`compose.yml` 启动两个 service，共用同一个数据卷 `./data:/var/lib/jant`：

- **`jant-migrate`** —— 每次 `docker compose up` 时跑一次 `jant migrate`。迁移失败，`jant` 不会启动。
- **`jant`** —— 长期运行的应用容器，监听 `3000` 端口。

跑起来之后，宿主机的 `./data/` 下会出现：

- `jant.sqlite` —— SQLite 数据库
- `media/` —— 上传的媒体文件

镜像和 Compose 已经预设了几个默认值，正常不用改：

| 变量          | 默认值          | 来源    | 作用                     |
| ------------- | --------------- | ------- | ------------------------ |
| `HOST`        | `0.0.0.0`       | 镜像    | 容器内监听地址           |
| `PORT`        | `3000`          | 镜像    | 容器内监听端口           |
| `HOST_PORT`   | `3000`          | Compose | 映射到宿主机的端口       |
| `DATA_DIR`    | `/var/lib/jant` | 镜像    | 数据库和本地媒体的根目录 |
| `TRUST_PROXY` | `true`          | Compose | 信任 `X-Forwarded-*`     |
| `TZ`          | `UTC`           | Compose | 容器时区                 |

需要覆盖时，写进 `.env` 即可。

## 数据库

Jant 通过 `DATABASE_URL` 的 scheme 决定连哪种数据库：

- `file:` —— SQLite（默认）
- `postgres:` 或 `postgresql:` —— Postgres

### SQLite（默认）

镜像里已经设好 `DATA_DIR=/var/lib/jant`。如果 `DATABASE_URL` 留空，Jant 会从 `DATA_DIR` 推导出 SQLite 路径，等同于：

```env
DATA_DIR=/var/lib/jant
DATABASE_URL=file:/var/lib/jant/jant.sqlite
```

因为这两个默认值是配套的，默认 Compose 不需要在 `.env` 里写任何数据库相关的变量——容器内的 `/var/lib/jant` 通过卷映射到宿主机的 `./data/`，所以最终落成 `./data/jant.sqlite`。

只有在你想换路径时才需要显式设置，比如：

```env
DATABASE_URL=file:/var/lib/jant/custom.sqlite
```

### 切换到 Postgres

直接用 `postgres:` URL 覆盖：

```env
DATABASE_URL=postgres://<user>:<password>@<host>:5432/<db>
```

切完之后 SQLite 文件就不会再被读写，但本地媒体目录（`./data/media/`）仍由本地存储驱动管理，除非同时切到 S3。

## 媒体存储

默认用本地存储，文件落在 `./data/media/`。够用、起步快，缺点是媒体和应用主机绑在一起，迁移、重建容器都要带着这堆文件走。

长期运行更推荐 S3 兼容存储（AWS S3、Backblaze B2、MinIO、DigitalOcean Spaces 等）：

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.us-east-1.amazonaws.com
S3_BUCKET=my-bucket
S3_REGION=us-east-1
S3_PUBLIC_URL=https://cdn.example.com
S3_ACCESS_KEY_ID=<access-key-id>
S3_SECRET_ACCESS_KEY=<secret-access-key>
```

字段含义和 CORS 设置见 [配置 § 存储](configuration.md#存储)。

## 反向代理与公开 URL

把 Jant 放在 Caddy、Nginx、Traefik 等反向代理后面是常见用法。Compose 已经默认 `TRUST_PROXY=true`，转发头会被尊重——主流配置下不用动任何变量。

只有这两种情况需要显式设置：

- **反向代理没正确传 `X-Forwarded-Host` / `X-Forwarded-Proto`**：RSS、sitemap、导出文件、auth 回调里的绝对 URL 会用错域名。在 `.env` 里写死 `SITE_ORIGIN=https://<your-domain>`。
- **挂在子路径下**（如 `example.com/blog`）：设 `SITE_PATH_PREFIX=/blog`。`SITE_ORIGIN` 是独立变量，只接受 origin（scheme + host + port），路径部分会被忽略——按上一条决定要不要设。

完整变量表见 [配置](configuration.md)。

## 不用 Compose 跑

如果只想起一个容器，先手动跑迁移再启动应用：

```bash
# 先跑迁移
docker run --rm \
  -e AUTH_SECRET=<auth-secret> \
  -v "$(pwd)/data:/var/lib/jant" \
  owenyoung/jant:latest \
  node bin/jant.js migrate

# 再启动应用
docker run -d \
  --name jant \
  -p 3000:3000 \
  -e AUTH_SECRET=<auth-secret> \
  -e TRUST_PROXY=false \
  -v "$(pwd)/data:/var/lib/jant" \
  owenyoung/jant:latest
```

容器在你自己的反向代理后面时，把 `TRUST_PROXY` 改成 `true`。

## 用命令行创建管理员账号

不在浏览器里初始化（比如用脚本部署）时，迁移之后跑 `jant setup`。它创建管理员账号和站点，并完成初始化。密码从标准输入读：

```bash
printf '%s' "$OWNER_PASSWORD" | docker run --rm -i \
  -v "$(pwd)/data:/var/lib/jant" \
  owenyoung/jant:latest \
  node bin/jant.js setup --email you@example.com --password-stdin --site-name "My Blog"
```

`--language` 默认是 `en`，`--time-zone` 默认是 `UTC`，全部参数见 `node bin/jant.js setup --help`。已经初始化过的站点不会被改动，所以每次启动都跑这条命令，也不会把之后改过的密码改回去。

## 更新站点

拉最新镜像并重启就行：

```bash
docker compose pull
docker compose up -d
```

每次 `up` 都会先跑 `jant-migrate`，迁移成功后才启动 `jant`。新镜像带的迁移会自动应用；如果迁移失败，`jant` 不会启动，数据库不会停留在 schema 不匹配的状态。

需要可重复部署时，把镜像 tag 固定下来：

```env
IMAGE=owenyoung/jant:<version>
```

## 常用命令

```bash
docker compose logs -f       # 跟随日志
docker compose ps            # 查看 service 状态
docker compose down          # 停止整个栈
```

## 备份

默认 Docker 配置下，一次完整备份至少要包含：

- `./data/jant.sqlite` —— 数据库
- `./data/media/` —— 上传的媒体

详见 [备份与恢复](backups.md)。

## 接下来

- [配置](configuration.md) —— 全部环境变量和站点行为
- [写作与内容组织](writing-and-organizing.md) —— 站点跑起来后开始写
- [备份与恢复](backups.md) —— 长期运行需要的恢复规划
