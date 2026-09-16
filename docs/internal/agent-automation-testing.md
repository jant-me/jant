# Agent Automation Testing

这份文档记录和 agent 自动化相关的手工验证路径。

适用变更范围：

- `sites/demo` 下的 `AGENTS.md`、`.agents/skills/`、`.claude/`
- `packages/create-jant` 对模板和脚手架的同步逻辑
- `/api/posts`、`/api/upload`、`/api/uploads`、`/api/attachments`、`/api/settings`、`/api/search`、`/api/mcp`
- 生成项目里的 `examples/agent-content-automation/`

目标不是每次都跑满所有步骤，而是按改动范围选一层或多层验证。

## 1. 最小文档验证

只改文档、提示词或样例说明时，通常先跑这一层就够了：

```bash
pnpm exec prettier --write \
  docs/API.md \
  docs/getting-started.md \
  docs/zh-Hans/automation-and-api.md \
  docs/zh-Hans/getting-started.md \
  docs/zh-Hans/overview.md \
  docs/zh-Hans/SUMMARY.md
```

如果改动只落在内部文档，把文件列表缩小到实际修改的文档即可。

## 2. 脚手架合同验证

当你改了 `sites/demo`、`packages/create-jant` 或任何会影响生成项目内容的文件时，先验证脚手架合同。

重要前提：

- 生成项目默认安装的是 npm 上已发布的 `@jant/core` 版本。
- 它不会自动使用你当前仓库 checkout 里尚未发布的 `packages/core`。
- 如果你正在验证未发布的 `@jant/core` 运行时改动，生成项目安装依赖后需要额外切到本地包，否则你测到的是已发布版本。

### 2.1 同步模板

```bash
pnpm --filter create-jant prepublishOnly
```

这一步会把 `sites/demo` 同步到 `packages/create-jant/template/`。

### 2.2 生成一个临时项目

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
TMP_DIR=$(mktemp -d /tmp/jant-agent-e2e.XXXXXX)
cd "$TMP_DIR"
node "$REPO_ROOT/packages/create-jant/dist/index.js" site --no-git -y
cd site
```

注意：

- 不要把绝对路径直接传给 `create-jant`。当前 CLI 会把绝对路径当成项目名做 sanitize。
- 先进目标父目录，再传相对项目名，例如这里的 `site`。

### 2.3 检查生成结果

```bash
find . -maxdepth 3 \
  \( -path '*/.agents/*' \
  -o -path '*/.claude/*' \
  -o -path '*/examples/agent-content-automation/*' \
  -o -name 'AGENTS.md' \
  -o -name 'CLAUDE.md' \) | sort
```

至少要看到这些东西：

- `AGENTS.md`
- `CLAUDE.md`
- `.agents/skills/`
- `.claude/skills/`
- `examples/agent-content-automation/README.md`

确认 `.claude/skills` 是复制目录，不是 symlink：

```bash
test ! -L ./.claude/skills && echo ".claude/skills is copied"
```

### 2.4 验证未发布 core 改动时切到本地包

只有当你这次改动碰到了 `packages/core` 的未发布运行时代码时，才需要做这一步。

先在仓库根目录把本地包构建到最新：

```bash
cd "$REPO_ROOT"
pnpm --filter @jant/core build
```

然后在生成项目里切到本地包：

```bash
cd "$TMP_DIR/site"
pnpm add "@jant/core@file:$REPO_ROOT/packages/core"
```

验证安装结果：

```bash
pnpm list @jant/core
```

如果你跳过这一步，生成项目里的 `pnpm dev`、`jant migrate` 等命令跑的仍然是已发布版本，而不是当前 checkout。

## 3. 生成站点手工验证

当你改了 CLI、HTTP API、MCP、上传流程或样例时，建议至少跑这一层。

### 3.1 安装并启动站点

在刚生成的临时项目里：

```bash
pnpm install
pnpm dev
```

如果你遇到本地代理环境导致的 Wrangler 输出污染，例如：

```text
Proxy environment variables detected. We'll use your proxy for fetch requests.
```

而生成项目里的 `@jant/core` 还是已发布旧版本，可以先临时去掉代理变量再启动：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  -u http_proxy -u https_proxy -u all_proxy \
  pnpm dev
```

本地 D1 / 本地 dev server 通常不需要这组代理变量。

然后：

1. 打开本地站点
2. 完成 onboarding
3. 在设置页创建一个 API token

准备环境变量：

```bash
export JANT_URL=http://127.0.0.1:3000
export JANT_API_TOKEN=你的token
```

### 3.2 验证 HTTP API

跑一组最短内容自动化样例：

```bash
curl -X POST "$JANT_URL/api/posts" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/agent-content-automation/note.json

curl -X PUT "$JANT_URL/api/settings" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/agent-content-automation/site-settings.json

curl "$JANT_URL/api/search?q=quiet+design" \
  -H "Authorization: Bearer $JANT_API_TOKEN"
```

如果要验证上传，准备一张本地图片，再执行：

```bash
curl -X POST "$JANT_URL/api/upload" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -F "file=@./path/to/photo.webp" \
  -F "alt=Cover image"

curl "$JANT_URL/api/upload?mimePrefix=image/" \
  -H "Authorization: Bearer $JANT_API_TOKEN"
```

通过标准：

- `POST /api/posts` 返回新建的 `pst_*`
- `PUT /api/settings` 返回更新后的 `settings`
- `GET /api/search` 返回合法 JSON，而不是认证或解析错误
- `POST /api/upload` 返回 `med_*`
- `GET /api/upload?mimePrefix=image/` 能看到刚上传的文件

### 3.3 额外的裸 API 检查

如果你改了 route、schema 或序列化逻辑，再补一轮：

```bash
curl "$JANT_URL/api/settings" \
  -H "Authorization: Bearer $JANT_API_TOKEN"
```

```bash
curl "$JANT_URL/api/attachments/med_xxx/content" \
  -H "Authorization: Bearer $JANT_API_TOKEN"
```

关注点：

- 状态码正确
- 返回的是现在文档承诺的字段
- `quote`、`text attachment`、`media` 三种形状没有互相串字段

### 3.4 验证 MCP

先初始化：

```bash
curl -X POST "$JANT_URL/api/mcp" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
```

再列出 tools：

```bash
curl -X POST "$JANT_URL/api/mcp" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

再实际调一个内容 tool：

```bash
curl -X POST "$JANT_URL/api/mcp" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"jant_posts_create","arguments":{"format":"note","bodyMarkdown":"Created through MCP.","status":"published","visibility":"public"}}}'
```

如果改动涉及 media，再补一轮：

- `jant_media_list`
- `jant_media_get`
- `jant_media_upload`
- `jant_attachments_get_content`

通过标准：

- `initialize` 返回 `protocolVersion: "2025-06-18"`
- `tools/list` 能看到新增或预期的工具名
- `tools/call` 的成功结果里有 `structuredContent`
- tool 级错误走 `isError: true`，而不是 route 级 500

## 4. 仓库级回归

当改动碰到 CLI、route、service、schema 或模板同步逻辑时，至少跑一组定向自动化检查。

### 4.1 基础检查

```bash
mise run check-types
mise run check-lint
```

### 4.2 定向测试

下面这组覆盖了当前 agent automation 相关的主要回归面：

```bash
pnpm exec vitest run \
  packages/core/src/routes/api/__tests__/upload.test.ts \
  packages/core/src/routes/api/__tests__/mcp.test.ts
```

如果你改到了 posts、collections、settings、search 的 route 序列化或 contract，再把这些一起带上：

```bash
pnpm exec vitest run \
  packages/core/src/routes/api/__tests__/posts.test.ts \
  packages/core/src/routes/api/__tests__/collections.test.ts \
  packages/core/src/routes/api/__tests__/settings.test.ts \
  packages/core/src/routes/api/__tests__/search.test.ts
```

### 4.3 模板回归

```bash
pnpm --filter create-jant prepublishOnly
```

如果你想把“生成模板 + 安装 + build/typecheck”整条链一起覆盖，再跑：

```bash
mise run check-template
```

## 5. 选层建议

常见场景可以直接按这个表选验证层级：

- 只改公开文档或样例文案：第 1 层
- 改 `sites/demo` / `create-jant`：第 2 层 + 第 4.3 层
- 改 `/api/posts`、`/api/settings`、`/api/search`、`/api/collections`：第 3.2 层 + 第 4.2 层
- 改 `/api/upload`、`/api/uploads`、`/api/attachments`：第 3.2 到 3.4 层 + 第 4.2 层
- 改 `/api/mcp` 或 tool schema：第 3.4 层 + 第 4.2 层
- 改用户能直接依赖的整体自动化体验：第 2、3、4 层都跑

## 6. 提交前最短清单

如果这次改动确实碰到了 agent automation 面：

1. `pnpm --filter create-jant prepublishOnly`
2. 生成一个临时项目并检查 `AGENTS.md`、`.agents/skills`、`.claude/skills`、`examples/agent-content-automation/`
3. 至少跑一次 `curl -X POST $JANT_URL/api/posts ...` 验证内容自动化
4. 如果碰到上传或 MCP，额外跑 `curl -X POST $JANT_URL/api/upload ...` 和 `/api/mcp initialize + tools/call`
5. 跑定向 Vitest
