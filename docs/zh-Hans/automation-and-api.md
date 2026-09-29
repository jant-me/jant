# 自动化与 API

让脚本、定时任务或 agent 操作自己的 Jant 站点：token 怎么签发、接口怎么调、失败怎么排查。

Jant 提供两条通道：

- **HTTP JSON API**：通用，curl 就能用。
- **MCP 接口**（`/api/mcp`）：给已经支持工具调用协议的 agent 用。

完整字段、请求体见 [API 参考（英文）](../API.md)。

用 `create-jant` 生成的项目里还有 `AGENTS.md`，它把 agent 指向运行中站点的 `/skill.md`、`npx jant --help` 和这份文档；另有 `examples/agent-content-automation/README.md`，里面是可以直接运行的请求。

## 先选哪条路

- 写脚本、跑定时任务、接外部系统：用 **HTTP API**。
- 调用方本身就是 MCP client：用 **MCP**。
- 让 AI 助手操作某个站点：把该站点的 `/skill.md` 地址（例如 `https://example.com/skill.md`）交给它。这是一份绑定当前站点的操作指南，讲清楚了怎么通过 HTTP 或 MCP 读取、发布、整理和迁移内容。迁移旧博客见[导出与导入](export-and-import.md#从别的博客或-cms-迁移过来)。

拿不准就走 HTTP。

## 本机 CLI

站点的初始化、部署、迁移和备份仍然走 CLI：`setup`、`migrate`、`deploy`、`reset-password`、`site export`、`site import`、`site snapshot`、`db export` 等。`site export` 和 `site import` 用 API token 调用站点的 API，其余命令直接读写数据库。详见 [命令行](cli.md)。

内容自动化（发帖、上传、改设置）一律走 HTTP 或 MCP。

## HTTP API

### 签发 token

1. 登录站点，进入 **Settings → API Tokens**。
2. 点 **New Token**，给它起一个有辨识度的名字——撤销时找得到谁在用。
3. 复制以 `jnt_` 开头的字符串。**只会显示一次**，丢了只能重新签发。

要撤销就在同一页删掉，立即生效。目前所有 token 都是站点级的完整读写权限，没有作用域，也没有过期时间——这两项以后可能会补上，本页同步更新。

本地开发可以用 `packages/core/.dev.vars` 里的 `DEV_API_TOKEN`，用法相同。

### 认证

请求头带：

```
Authorization: Bearer jnt_...
```

少量公开读接口默认不需要 token：`GET /api/public/threads`、`GET /api/public/threads/:slug`、`GET /api/public/threads/:slug/posts` 和 `GET /api/public/posts/:slug`。如果设置了 `PUBLIC_API_ENABLED=false`，`/api/public/*` 会对所有调用方返回 `404`。包括 `/search` 在内的公开 HTML 页面不受影响。

### 常用端点

| 端点                     | 方法                      | 用途                                                                               |
| ------------------------ | ------------------------- | ---------------------------------------------------------------------------------- |
| `/api/posts`             | GET / POST / PUT / DELETE | 列出、读取、创建、更新、删除帖子                                                   |
| `/api/threads`           | GET                       | 列出 Thread、读取单个 Thread、分页读取其中的帖子，含草稿和私密 Thread              |
| `/api/public/threads`    | GET                       | 公开读取 Thread——默认是首页的列表，支持归档的过滤条件（无需 token）                |
| `/api/public/posts`      | GET                       | 按 slug 公开读取一篇已发布的帖子（无需 token）。帖子列表改用 `/api/public/threads` |
| `/api/upload`            | POST                      | 一次性 multipart 上传，单次一文件，脚本首选                                        |
| `/api/media`             | GET / PUT / DELETE        | 列出、读取、改 alt 文本、删除已上传的文件                                          |
| `/api/uploads`           | POST → PUT → POST         | 分片上传会话，大文件或不稳定网络用                                                 |
| `/api/attachments`       | GET                       | 按 id 读取附件原始内容                                                             |
| `/api/collections`       | GET / POST / PUT / DELETE | 合集                                                                               |
| `/api/smart-collections` | GET / POST / PUT / DELETE | 智能合集——成员由条件决定的合集                                                     |
| `/api/settings`          | GET / PUT                 | 站点设置                                                                           |
| `/api/search`            | GET                       | 全文搜索已发布的帖子，含私密帖子                                                   |
| `/api/mcp`               | POST                      | MCP JSON-RPC（`initialize` / `tools/list` 等）                                     |

`/api/upload` 与 `/api/uploads` 只差一个 s，但语义完全不同——前者是单文件 multipart 一次完成，后者是 init/part/complete 三步分片会话。脚本首选 `/api/upload`，遇到大文件或不稳定连接再换 `/api/uploads`。

### 最短示例：发一条 note

```bash
curl -X POST "$JANT_URL/api/posts" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "note",
    "bodyMarkdown": "Hello from curl."
  }'
```

`examples/agent-content-automation/` 里有一个 `quote` 帖子和一次设置更新可以照着改。全部字段（包括 `collectionIds`、`publishedAt`、`slug`、`pinned`、`featured`）见 [API 参考（英文）](../API.md#create-a-post)。

### 上传一张图

```bash
curl -X POST "$JANT_URL/api/upload" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -F "file=@./path/to/photo.webp;type=image/webp" \
  -F "alt=封面图"
```

### 更新设置

```bash
curl -X PUT "$JANT_URL/api/settings" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/agent-content-automation/site-settings.json
```

### 错误响应

`/api` 下所有失败都返回 JSON，结构固定：

```json
{
  "error": "human readable message",
  "code": "ERROR_CODE",
  "details": {
    "formErrors": [],
    "fieldErrors": { "title": ["..."] }
  }
}
```

`details` 仅在 400 校验失败时出现，列出没通过的字段。常见状态码：

| 状态 | `code`                      | 含义与处理                                   |
| ---- | --------------------------- | -------------------------------------------- |
| 400  | `VALIDATION_ERROR`          | 请求体校验失败，看 `details` 修正            |
| 401  | `UNAUTHORIZED`              | token 缺失或失效，重新签发并替换环境变量     |
| 403  | `FORBIDDEN`                 | token 有效但无权访问该资源                   |
| 404  | `NOT_FOUND`                 | 资源不存在                                   |
| 409  | `CONFLICT` 等               | 状态冲突（如 slug 重复、托管媒体配额超限）   |
| 500  | `EXTERNAL_SERVICE_ERROR` 等 | 服务端错误，重试；持续失败就带上请求详情反馈 |

### 速率限制

API 没有硬性限速。搜索限速（[配置](configuration.md)里的 `RATE_LIMIT_SEARCH_PER_MIN`）只作用于未登录读者访问的 `/search` 页面，不作用于 `/api/search`。不过 Cloudflare Workers 单实例并发有限——批量写入按顺序调用，必要时在两次写之间留一点间隔。以后如果给 API 加了限速，会通过 `429` 加 `Retry-After` 返回，本节同步更新。

## MCP 接口

给已经支持 MCP 的 agent 用，底层是 HTTP JSON-RPC：

- **路径**：`/api/mcp`
- **认证**：脚本/agent 用 `Authorization: Bearer jnt_...`；同源浏览器扩展可复用 session cookie。
- **协议头**：`MCP-Protocol-Version: 2025-06-18`。不带这个头按这个版本处理，带其他版本返回 `400`。版本升级时本页同步更新。
- **方法**：`initialize`、`ping`、`tools/list`、`tools/call`。

工具覆盖帖子、Thread、媒体、附件、合集、设置和搜索，每个工具的行为和对应的 HTTP 端点一致。导航、自定义 URL、智能合集、合集目录、在合集中置顶 Thread、译文、头像和图标上传以及导出只能走 HTTP。具体工具名和入参用 `tools/list` 拿到。

最小初始化请求：

```bash
curl -X POST "$JANT_URL/api/mcp" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
```

适合走 MCP 的场景：调用方已经有 MCP client；想把 Jant 暴露成一组工具，而不是手写 fetch。

不适合走 MCP 的场景：简单 shell 脚本；本地内容批量导入；不需要工具发现或工具调用协议。

## 推荐起点

想让 agent 稳定发帖、传图、改设置，跑通这三个 HTTP 调用就够了：

1. `POST /api/posts`
2. `POST /api/upload`
3. `PUT /api/settings`

这三条稳定后，再考虑 MCP、多工具编排，或更复杂的内容工作流。

## 接下来

- [API 参考（英文）](../API.md) —— 完整字段、请求体、错误格式
- [常见问题](faq.md)
- `examples/agent-content-automation/README.md` —— 生成的项目里可直接运行的端到端样例
