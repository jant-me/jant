# 自动化与 API

让脚本、定时任务或 agent 操作自己的 Jant 站点，从这里开始：怎么签发 token、调哪些接口、出错怎么排查。

Jant 提供两条通道：

- **HTTP JSON API**：通用，curl 就能用。
- **MCP 接口**（`/api/mcp`）：给已经支持工具调用协议的 agent 用。

完整字段、请求体见 [API 参考（英文）](../API.md)。

如果你是用 `create-jant` 新建的站点，脚手架默认还会带上这些文件：

- `AGENTS.md`
- `.agents/skills/`
- `.claude/skills/`
- `examples/agent-content-automation/README.md`

agent 在生成项目里拿到的不只是 API token，还有项目约定和现成样例。

## 先选哪条路

- 写脚本、跑定时任务、接外部系统：用 **HTTP API**。
- 调用方本身就是 MCP client：用 **MCP**。
- 让 AI 助手操作某个站点：把该站点的 `/skill.md` 地址（例如 `https://example.com/skill.md`）交给它——这是一份绑定当前站点的指南，涵盖通过 HTTP 或 MCP 读取、发布、整理和迁移内容。迁移时使用其中专门的导入流程，并参阅[导出与导入](export-and-import.md#从别的博客或-cms-迁移过来)。

默认走 HTTP，MCP 只在调用方已经支持工具调用协议时才更顺手。

## 本机 CLI

涉及本机环境和数据库的操作仍然走 CLI：`migrate`、`deploy`、`reset-password`、`site snapshot`、`site export`、`site import`、`db export` 等。这些命令直接读写数据库或站点部署，不走 HTTP，也不需要 API token。详见 [导出与导入](export-and-import.md)。

内容自动化（发帖、上传、改设置）一律走 HTTP 或 MCP。

## HTTP API

### 签发 token

1. 登录站点，进入 **Settings → API Tokens**。
2. 点 **New Token**，给它起一个有辨识度的名字——撤销时找得到谁在用。
3. 复制以 `jnt_` 开头的字符串。**只会显示一次**，丢了只能重新签发。

撤销在同一页删除即可，立即生效。当前所有 token 都是站点级、读写完整权限，没有作用域和过期时间——这两项后续可能补上，本文档会同步更新。

本地开发可以用 `packages/core/.dev.vars` 里的 `DEV_API_TOKEN`，用法相同。

### 认证

请求头带：

```
Authorization: Bearer jnt_...
```

少量公开读接口默认不需要 token：`GET /api/collections`、`GET /api/collections/:id`、`GET /api/nav-items`、`GET /api/search`、`GET /api/public/posts`、`GET /api/public/posts/:slug`、`GET /api/public/archive`。如果设置了 `PUBLIC_API_ENABLED=false`，`/api/public/*` 会对所有调用方返回 `404`；Collection、导航和搜索 JSON 读取则需要浏览器 session 或 Bearer token。包括 `/search` 在内的公开 HTML 页面不受影响。

### 常用端点

| 端点                  | 方法                        | 用途                                                                         |
| --------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| `/api/posts`          | GET / POST / PUT / DELETE   | 帖子的列表、读取、创建、更新、删除                                           |
| `/api/public/posts`   | GET                         | 公开读取已发布的帖子（无需 token）                                           |
| `/api/public/archive` | GET                         | 公开归档接口 —— 包含 `latest_hidden`，支持按年份/媒体/标题过滤（无需 token） |
| `/api/upload`         | POST / GET / PATCH / DELETE | 一次性 multipart 上传，单次一文件，脚本首选                                  |
| `/api/uploads`        | POST → PUT → POST           | 分片上传会话，大文件或不稳定网络用                                           |
| `/api/attachments`    | GET                         | 按 id 读取附件原始内容                                                       |
| `/api/collections`    | GET / POST / PUT / DELETE   | 合集（GET 不需要 token）                                                     |
| `/api/settings`       | GET / PUT                   | 站点设置                                                                     |
| `/api/search`         | GET                         | 全文搜索（公开，按 IP 限速）                                                 |
| `/api/mcp`            | POST                        | MCP JSON-RPC（`initialize` / `tools/list` 等）                               |

`/api/upload` 与 `/api/uploads` 只差一个 s，但语义完全不同——前者是单文件 multipart 一次完成，后者是 init/part/complete 三步分片会话。脚本首选 `/api/upload`，遇到大文件或不稳定连接再换 `/api/uploads`。

### 最短示例：发一条 note

```bash
curl -X POST "$JANT_URL/api/posts" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "note",
    "body": "Hello from curl."
  }'
```

更多 format（`link`、`quote`）和高级字段（`collections`、`publishedAt`、`slug`、`pinned`、`featured`）见 `examples/agent-content-automation/`。

### 上传一张图

```bash
curl -X POST "$JANT_URL/api/upload" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -F "file=@./path/to/photo.webp" \
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

API 路径下所有失败都返回 JSON，结构固定：

```json
{
  "error": "human readable message",
  "code": "ERROR_CODE",
  "details": "..."
}
```

`details` 仅在 400 校验失败时出现，包含具体字段信息。常见状态码：

| 状态 | `code`                      | 含义与处理                                    |
| ---- | --------------------------- | --------------------------------------------- |
| 400  | `VALIDATION_ERROR`          | 请求体校验失败，看 `details` 修正             |
| 401  | `UNAUTHORIZED`              | token 缺失或失效，重新签发并替换环境变量      |
| 403  | `FORBIDDEN`                 | token 有效但无权访问该资源                    |
| 404  | `NOT_FOUND`                 | 资源不存在                                    |
| 409  | `CONFLICT` 等               | 状态冲突（如 slug 重复、托管媒体配额超限）    |
| 429  | `RATE_LIMIT`                | 触发速率限制，见下节                          |
| 500  | `EXTERNAL_SERVICE_ERROR` 等 | 服务端错误，重试，仍失败请带 request 信息反馈 |

### 速率限制

目前只有 `/api/search` 设了按 IP 的每分钟上限（值由部署侧 `appConfig.rateLimit.searchPerMinute` 控制，默认值见 [配置](configuration.md)）。其他接口暂未做硬性限速，但 Cloudflare Workers 单实例并发有限——批量写入请保持顺序调用，必要时在两次写操作之间留一点间隔。如果未来引入更多限速，会通过 `429` 加 `Retry-After` 返回，本节同步更新。

## MCP 接口

给已经支持 MCP 的 agent 用，底层是 HTTP JSON-RPC：

- **路径**：`/api/mcp`
- **认证**：脚本/agent 用 `Authorization: Bearer jnt_...`；同源浏览器扩展可复用 session cookie。
- **协议头**：`MCP-Protocol-Version: 2025-06-18`。版本升级时本文档同步更新。
- **方法**：`initialize`、`ping`、`tools/list`、`tools/call`。

工具按资源分组：`posts`、`media`、`attachments`、`collections`、`settings`、`search`。具体工具名和入参用 `tools/list` 拿到，和 HTTP 端点一一对应。

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

## 推荐起点：先跑通这三个调用

如果目标只是「让 agent 能稳定发帖、传图、改设置」，先把这三个 HTTP 调用跑通就够了：

1. `POST /api/posts`
2. `POST /api/upload`
3. `PUT /api/settings`

这三条稳定后，再考虑 MCP、多工具编排，或更复杂的内容工作流。

## 接下来

- [API 参考（英文）](../API.md) —— 完整字段、请求体、错误格式
- [常见问题](faq.md)
- 生成项目里的 `examples/agent-content-automation/README.md` —— 可直接运行的端到端样例
