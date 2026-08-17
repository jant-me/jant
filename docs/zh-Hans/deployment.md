# 部署到 Cloudflare

Cloudflare 是 Jant 推荐的部署平台。两条路径任选其一：

- **一键部署**：点 Deploy 按钮，约 5 分钟完成。资源全部由 Cloudflare 在你账号下自动创建。
- **本地开发后再部署**：先在本地跑通，再用 Wrangler 上线。适合想先调主题或做离线调试的人。

部署完成后还要绑定自定义域名、配置 R2 公开访问，否则媒体会经 Worker 中转，消耗免费额度。

> 想部署在自己的服务器上，见 [使用 Docker 部署](deployment-docker.md)。

## 占位符约定

正文里所有 `<...>` 都需要替换成你自己的值。

| 占位符           | 含义                                          |
| ---------------- | --------------------------------------------- |
| `<github-user>`  | GitHub 用户名                                 |
| `<repo>`         | 一键部署生成的仓库名                          |
| `<project>`      | Worker 项目名（一键部署默认 `my-site`）       |
| `<account>`      | Cloudflare 子域前缀，部署后由 Cloudflare 给出 |
| `<your-domain>`  | 你的自定义域名                                |
| `<media-domain>` | R2 媒体子域，例如 `media.<your-domain>`       |
| `<database-id>`  | `wrangler d1 create` 输出的 D1 数据库 ID      |

## 前置条件

- **Cloudflare 账号**：[dash.cloudflare.com](https://dash.cloudflare.com/) 注册或登录。
- **GitHub 账号**：一键部署会把代码托管到 GitHub。前往 [github.com](https://github.com/) 注册或登录。
- **启用 R2**：进入 [R2 控制台](https://dash.cloudflare.com/?to=/:account/r2)，点 **Enable R2** 接受条款。这一步必须先做——跳过的话，部署会报 `uses R2 which is only available with an R2 subscription`。R2 用于存放上传的图片和视频，免费额度 10 GB 存储 + 每月 100 万次读取。
- **自定义域名**（推荐）：托管在同一个 Cloudflare 账号下。如果还没有，先把域名的 DNS 托管到 Cloudflare。
- **本地开发路线还需要**：[Node.js](https://nodejs.org/) 24+、`git`、`openssl`。

## 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jant-me/jant-starter)

点 Deploy 按钮后，Cloudflare 会按表单内容自动创建 GitHub 仓库、D1 数据库、R2 存储桶，并完成首次部署。

### 表单填写

| 字段                       | 说明                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Git account**            | 选你的 GitHub 账号。首次使用时点 **New GitHub Connection** 完成授权，Cloudflare 会自动创建仓库。                                    |
| **Project name**           | 默认为 `my-site`。这个值同时是站点子域 `<project>.<account>.workers.dev` 和 GitHub 仓库名。现在就改成你要用的名字，例如 `my-blog`。 |
| **D1 database**            | 保持默认 **Create new**，名称用默认值。                                                                                             |
| **Database location hint** | 选离你近的区域，保持默认也行。                                                                                                      |
| **R2 bucket**              | 保持默认 **Create new**，名称用默认值。                                                                                             |
| **AUTH_SECRET**            | 保留自动生成的值，或换成自己的 32 字节以上随机字符串。它用于会话签名，上线后不要修改。                                              |

部署完成后，Cloudflare 会显示形如 `https://<project>.<account>.workers.dev` 的地址。**先不要创建管理员账号**——下一步绑定自定义域名后再创建，避免会话在切换域名时失效。

### 克隆到本地（推荐）

一键部署已经在你的 GitHub 账号下建好了仓库。克隆到本地后可以：

- 改 `wrangler.toml` 里的环境变量（下一节会用到）
- 改主题、加页面、升级依赖
- 推送到 `main`，自动触发重新部署

```bash
git clone git@github.com:<github-user>/<repo>.git
cd <repo>
npm install
```

不想克隆也行，下一节的所有配置都能在 Cloudflare 控制台完成。

## 上线前必做

完成下面三步后再创建管理员账号。

### 1. 绑定自定义域名

1. 打开 [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)，选中你的 Worker。
2. 进入 **Settings** → **Domains & Routes** → **Add**。
3. 填入你的域名 `<your-domain>`。

域名在同一个 Cloudflare 账号下时，DNS 记录会自动写入，证书通常 1–2 分钟内签发。

### 2. 配置 R2 公开访问

不配置时，每次访问图片或视频都要经 Worker 中转，速度慢且消耗 Worker 配额。配置 `R2_PUBLIC_URL` 后，媒体直接从 R2 公开域返回。

**给 R2 存储桶绑定一个公开子域**

1. 打开 [R2 控制台](https://dash.cloudflare.com/?to=/:account/r2)，点开你的存储桶。
2. **Settings** → **Public access** → **Custom Domains** → **Connect Domain**。
3. 填一个属于你域名的子域，例如 `media.<your-domain>`。
4. Cloudflare 自动写入 CNAME 并签发证书。状态从 `Initializing` 变为 `Active` 后，**完整复制 Public URL**（形如 `https://<media-domain>`，末尾没有斜杠）。

不要使用 r2.dev 的临时公开 URL——它有速率限制，不能用于生产。

如果状态长时间停在 `Initializing`，通常是该子域已被其他 DNS 记录占用——到 Cloudflare DNS 页面删除冲突记录后会自动恢复。

**把 URL 配给 Worker**，任选其一：

- **控制台**：[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → 选中 Worker → **Settings** → **Variables and Secrets** → **Add**。名称 `R2_PUBLIC_URL`，值 `https://<media-domain>`。保存后会自动重新部署。
- **代码**：在 `wrangler.toml` 的 `[vars]` 段下加：

  ```toml
  [vars]
  R2_PUBLIC_URL = "https://<media-domain>"
  ```

  推送到 `main`，或运行 `npm run deploy`。

验证：打开一张已上传的图片，页面源码里的 `<img src>` 应该是 `https://<media-domain>/...`，而不是 `<project>.<account>.workers.dev/...`。

### 3. 启用图片自动缩放（可选）

开启 [Image Transformations](https://developers.cloudflare.com/images/transform-images/) 后，Jant 会按访问者的屏幕宽度和像素密度请求对应尺寸，避免手机加载 4000px 原图。

每月前 5000 次变换免费，超出后约 $0.50 / 1000 次。每张原图按需衍生 3–5 个尺寸，个人站基本不会触发付费。

> 图片变换是域名（zone）级功能，需要先按上一步配置好 R2 自定义域名。

1. 在 [Cloudflare 控制台](https://dash.cloudflare.com/) 选中你绑定的域名。
2. 左侧菜单 → **Images** → **Transformations**。
3. 把对应域名开关切到 **On**（首次启用会弹出条款确认）。

把 `IMAGE_TRANSFORM_URL` 加到 Worker（添加方式同 `R2_PUBLIC_URL`），值为：

```
https://<media-domain>/cdn-cgi/image
```

## 初始化管理员

打开 `https://<your-domain>`，按提示创建管理员账号、设置站点名称。

更多可配置项见 [配置](configuration.md)。

## 本地开发后再部署

想先在本地搭好再上线，走这条路径。

```bash
npm create jant@latest jant-site
cd jant-site
```

`pnpm` 或 `yarn` 同样可用：

```bash
pnpm create jant@latest jant-site
yarn create jant@latest jant-site
```

`create-jant` 会安装依赖、初始化 git、生成本地 `.dev.vars`（含本地 `AUTH_SECRET`），并创建已绑定 D1 和 R2 的 Wrangler 项目。

### 本地启动

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，按提示完成初始化（管理员账号、站点名、语言）。

换端口：

```bash
PORT=8787 npm run dev
```

### 部署到 Cloudflare

按顺序执行：

1. **登录 Wrangler**

   ```bash
   npx wrangler login
   ```

   浏览器会跳转到授权页面，授权后终端显示 `Successfully logged in`。

2. **创建 D1 数据库**

   ```bash
   npx wrangler d1 create <project>-db
   ```

   把输出中的 `database_id` 写到 `wrangler.toml` 里 `[[d1_databases]]` 段：

   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "<project>-db"
   database_id = "<database-id>"
   ```

   `database_name` 必须与刚才传给 `d1 create` 的名字一致。

3. **创建 R2 存储桶**

   ```bash
   npx wrangler r2 bucket create <project>-media
   ```

   `wrangler.toml` 里 `[[r2_buckets]]` 的 `bucket_name` 必须与之一致：

   ```toml
   [[r2_buckets]]
   binding = "R2"
   bucket_name = "<project>-media"
   ```

4. **设置生产 `AUTH_SECRET`**

   `.dev.vars` 里的密钥只用于本地。生产密钥用下面的命令写入：

   ```bash
   openssl rand -base64 32 | npx wrangler secret put AUTH_SECRET
   ```

   一旦站点上线，**不要修改这个值**——会让所有现存会话失效。

5. **部署**

   ```bash
   npm run deploy
   ```

   `npm run deploy` 调用 `jant deploy`，依次：
   1. 应用 D1 迁移和数据补丁。
   2. 上传 Worker 代码与静态资源。

   成功后终端会打印形如 `https://<project>.<account>.workers.dev` 的地址。回到 [上线前必做](#上线前必做) 完成自定义域名和 R2 公开访问，再创建管理员。

## 进阶配置

### 通过 GitHub Actions 自动部署

`create-jant` 创建的项目里已内置 `.github/workflows/deploy.yml`。在 GitHub 仓库加两个 Secret，之后每次推送 `main` 都会自动部署：

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`

获取方式：

- **`CF_ACCOUNT_ID`**：[Cloudflare 控制台](https://dash.cloudflare.com/) → 任意 Worker 或 Pages 项目 → 右侧栏 **Account ID**。
- **`CF_API_TOKEN`**：[API Tokens 页面](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → 选 **Edit Cloudflare Workers** 模板（已包含部署 Worker、读写 D1、读写 R2 所需权限）。按提示选账号和域名（如果用了自定义域名），生成后**立即复制**——关闭页面后无法再次查看。

添加到 GitHub：仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**。

### 部署在子路径下

把 Jant 挂在某个子路径下（如 `<your-domain>/blog`），主域留给其他服务，需要两步：

1. 告诉 Jant 子路径前缀：

   ```toml
   [vars]
   SITE_PATH_PREFIX = "/blog"
   ```

   Jant 会在部署时把带前缀的静态资源准备到 `/blog/_assets/*`。

2. 在 [Cloudflare 控制台](https://dash.cloudflare.com/) → 选中你的域名 → **Workers Routes** → **Add route**，填 `<your-domain>/blog*`，Worker 选你的 Jant Worker。

`SITE_PATH_PREFIX` 与 `SITE_ORIGIN` 是两个独立变量。`SITE_ORIGIN` 只接受 origin（scheme + host + port），路径部分会被忽略——子路径必须通过 `SITE_PATH_PREFIX` 设置。详细说明见 [配置 § 公开 URL 和子路径](configuration.md#公开-url-和子路径)。

## 升级

升级前先读 [发布说明](https://github.com/jant-me/jant/releases)，留意破坏性变更。然后更新 `@jant/core` 并部署：

```bash
npm install @jant/core@latest
npm run dev      # 本地验证；新迁移会应用到本地 D1
npm run deploy   # 部署到 Cloudflare；远端迁移在部署时应用
```

如果你的仓库已配置 push 自动部署（一键部署，或上面的 GitHub Actions 工作流），可以跳过本地命令：提交更新后的 `package.json` 与 lockfile，推送到 `main` 即可。远端迁移会作为部署的一部分自动执行。

涉及替换或删除数据库表的升级，先读发布说明。`jant deploy` 会先执行迁移，再上传新版 Worker，因此破坏性的 schema 切换可能需要短暂停写。在迁移、Worker 上传和部署后检查全部完成前，停掉或排空旧版本的写入实例。迁移校验能发现脏数据和数量对不上，但表替换期间的并发写入仍然不安全。

## 常见错误

- `uses R2 which is only available with an R2 subscription`：没启用 R2，到 [R2 控制台](https://dash.cloudflare.com/?to=/:account/r2) 接受条款。
- `Authentication error [code: 10000]`：没登录或 token 过期，重新 `npx wrangler login`。
- `database_id "..." is invalid`：`wrangler.toml` 里的 `database_id` 占位符没替换成 `wrangler d1 create` 输出的真实 ID。
- `A worker with this name already exists`：改 `wrangler.toml` 顶部的 `name`。
- 自定义域名长时间 SSL pending：该子域已被其他 DNS 记录占用，到 DNS 页面删冲突记录后自动恢复。

## 接下来

- [配置](configuration.md) —— 环境变量与站点行为
- [写作与内容组织](writing-and-organizing.md) —— 上线后开始发布
- [备份与恢复](backups.md) —— 定期导出 D1 + R2，防止误删或账号回收
