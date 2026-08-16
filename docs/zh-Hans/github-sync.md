# GitHub 同步

GitHub 同步把你的帖子以 Markdown 文件备份到一个 GitHub 仓库，并把 GitHub 上的修改同步回来。每次帖子变动产生一个 commit，让你的内容拥有完整的 Git 版本历史。

仓库本身也是一个给 AI agent 用的接口。Jant 有 [HTTP API](../API.md) 和 MCP server，但很多 coding agent 直接读写 Markdown 文件比调 API 顺手——同步好的仓库就是一份它们能直接编辑、提交的内容副本。

## 工作原理

Jant 是 source of truth。GitHub 仓库是 Jant 内容的镜像，外加一个有限的回流通道：你可以在 GitHub 上编辑现有帖子的内容字段，但创建和删除只能在 Jant 里完成。

**Jant → GitHub**：当你创建、编辑或删除一篇帖子，Jant 把这次变更以带 YAML front matter 的 Markdown 文件推送到你的仓库。Thread 回复各自成为独立文件，嵌套在根帖目录下。媒体不进入仓库，仅以 URL 引用。

**GitHub → Jant**：当你在 GitHub 上编辑一个 Markdown 文件并 push，webhook 通知 Jant，Jant 按 front matter 里的 `slug` 字段匹配到已有帖子，更新内容。**webhook 只更新已存在帖子的内容字段——在 GitHub 上新增或删除 `.md` 文件不会在 Jant 里创建或删除帖子。** 这是为了避免误删（仓库被清空也不会拖垮站点）。

Jant 自己产生的 commit 会带上 `[jant-sync]` 标记。带这个标记的 webhook 会被忽略，所以变更不会来回反弹。

### 哪些字段会同步

- 帖子正文（front matter 下方的 Markdown）
- 标题、URL、来源信息、引文文本、评分等 front matter 字段
- Thread 回复（各自作为独立文件嵌套在根帖目录下）

设置、导航、Collections、主题不会被 webhook 影响。

## 连接

### Personal Access Token

没有配置 GitHub App 的部署采用这种方式。你需要一个 GitHub 的 **fine-grained personal access token**，对目标仓库授予以下权限：

| 权限         | 访问级别   | 用途                  |
| ------------ | ---------- | --------------------- |
| **Contents** | Read/Write | 读写 Markdown 文件    |
| **Webhooks** | Read/Write | 自动注册 push webhook |

在 [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta) 创建 token，建议把作用范围限定到单个仓库，只勾选 Contents 和 Webhooks 两项权限。

1. 在 GitHub 上创建一个仓库（公开私有都行）
2. 在 Jant 里打开 **Settings > Site > GitHub Sync**
3. 粘贴 token，输入仓库 `owner/repo`
4. 点击 **Connect**

Jant 会校验 token、保存配置，并在仓库里创建 webhook。不需要手动设置 webhook。

### GitHub App

部署配置了 GitHub App 时可用。你不需要接触任何长期 token——Jant 按需签发短期凭证。

1. 在 Jant 里打开 **Settings > Site > GitHub Sync**
2. 点击 **Install GitHub App**，跳转到 GitHub 选择 App 可访问的仓库
3. 安装完成后回到 Jant，选要同步的仓库，点 **Connect**

## 完整同步

首次连接后，Jant 会自动把全部内容推送一次。之后也可以在 **Settings > Site > GitHub Sync** 里点 **Sync Now** 重新执行。

### Jant 在仓库里管理哪些路径

下面这些路径完全由 Jant 管理，每次 push 都会被覆盖：

- `content/**` —— posts、collections、sections
- `themes/jant/**` —— 打包好的 Jant 主题（layouts 和 static assets）
- `data/jant.toml` —— 导航、品牌、collections directory
- `hugo.toml` —— 站点配置，包括 `theme = "jant"` 这一行
- `.gitignore`、`README.md` —— Jant 生成的脚手架
- `.jant-sync` —— 所有权标记

这些路径里 Jant 不再生成的文件会在下一次 push 时被删除。例如，在 Jant 里删除一篇帖子，下一次同步时 GitHub 上对应的 bundle 也会被删掉。

仓库里其他文件 Jant 不会动。要自定义站点：

- 在根目录加 `layouts/<name>.html` 或 `static/<name>` 覆盖主题里同名文件——Hugo 会优先用根目录版本。
- `data/` 下除 `data/jant.toml` 之外的位置可以放自定义文件（`menu.toml`、`authors.toml` 等）。
- 不要直接改 `themes/jant/**`——下一次 push 会覆盖。

详见 [导出与导入](export-and-import.md)。

## 增量同步

连接之后，每次在 Jant 里创建、编辑或删除帖子，都会自动把变更推送到 GitHub。每次变动产生独立的 commit：

- **创建或更新根帖**：写 `content/{slug}/_index.md`
- **创建或更新回复**：写 `content/{root-slug}/{reply-slug}/index.md`
- **删除**：从仓库里移除对应的 bundle

增量同步在后台运行，不会阻塞 Jant UI。

## 在 GitHub 上编辑

你可以直接在 GitHub 上编辑任何 Jant 管理的 Markdown 文件，或者本地修改后 push。push 到达 GitHub，webhook 触发，Jant 更新对应的帖子。

匹配规则按 slug 进行：Jant 读取 YAML front matter 里的 `slug` 字段，找到对应帖子。匹配不到的文件会被跳过。

会被 GitHub 编辑更新的字段：

- `body`（front matter 下方的 Markdown 内容）
- `title`
- `link_url`（link 帖子）
- `source_name`、`source_url`（link 和 quote 帖子的来源信息）
- `quote_text`（quote 帖子）
- `rating`

### 冲突处理

webhook 处理是后写覆盖：webhook 到达时 Jant 直接用文件内容更新帖子，不和 Jant 当前状态做合并。如果你在 Jant UI 编辑的同时又在 GitHub 上改了同一篇帖子，最后到达的那次会赢。后续的 Jant push 也会把 GitHub 上未回流的中间状态覆盖掉。两边同时编辑同一篇帖子请避免。

**不要改 `slug` 字段**：slug 是匹配键，改了之后这个文件会被当成「匹配不到的新文件」跳过，编辑不会落到 Jant 里。要改 URL 请在 Jant UI 里改。

## 后台处理

同步在后台运行，UI 永远不会卡在等 GitHub 响应——你点保存就立刻返回，push 在响应之后完成。

push 进行中时 settings 页会显示 **Syncing…**，完成后切换为 **Last synced**。push 失败时错误会直接显示在状态卡上，不用翻日志。

短时间内连续编辑会被合并：上一次 push 还没结束就来了新改动，新改动会被记成「待处理编辑」；当前 push 落地后再跑一轮，把最新状态推上去。不会丢内容、也不会出现并发 push。

实现备注：基于 Cloudflare Workers 的 `executionCtx.waitUntil`，不需要 queue binding 或独立的 consumer worker。

## 断开连接

打开 **Settings > Site > GitHub Sync**，点 **Disconnect**。Jant 会从 GitHub 移除 webhook，并清除同步配置。仓库和它的内容不会被删除。

## 文件格式

帖子以 Hugo 兼容的 Markdown 存储，使用扁平的 YAML front matter，和 [Site Export](export-and-import.md) 用的是同一种格式。

根帖位于 `content/{slug}/_index.md`：

```markdown
---
title: "Hello World"
date: 2025-01-15T12:00:00Z
slug: hello-world
type: post
format: note
status: published
visibility: public
---

帖子正文写在这里。
```

Thread 回复作为嵌套的 leaf bundle 位于 `content/{root-slug}/{reply-slug}/index.md`：

```markdown
---
title: ""
date: 2025-01-15T13:00:00Z
slug: reply-abc
type: post
build:
  render: never
  list: local
format: note
status: published
visibility: public
---

回复内容写在这里。
```

## 限制

- 每个站点只能连接一个仓库。
- 媒体附件和文本附件不进入仓库——媒体在 Markdown 里以 URL 形式引用，文本附件不参与 GitHub 同步。
- GitHub 对认证用户限速 5,000 次/小时。一次 1,000 篇帖子的完整同步用掉约 1,000 次请求，增量同步每次 1-2 次。

## 自部署：配置 GitHub App

本节面向在自己的 Jant 部署上配置 GitHub App 的管理员。通过 GitHub App 连接的终端用户只需参照上方的[连接](#连接)步骤操作即可。

在 Jant 部署上设置以下环境变量，即可启用 GitHub App 连接流程：

| 变量                        | 必需 | 说明                                                                                                                                                                 |
| --------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_APP_ID`             | 是   | GitHub App 设置页里的数字 App ID                                                                                                                                     |
| `GITHUB_APP_PRIVATE_KEY`    | 是   | 在 GitHub App 设置里生成的 PKCS#8 PEM 私钥。`\n` 转义会自动展开，所以你可以单行存放                                                                                  |
| `GITHUB_APP_SLUG`           | 是   | App slug（`github.com/apps/<slug>` 的最后一段）。用于构造安装 URL                                                                                                    |
| `GITHUB_APP_WEBHOOK_SECRET` | 否   | GitHub App webhook 的共享 secret。两个 endpoint 会用：单仓库 push webhook（优先级高于站点级 secret）和 App 级 webhook `/api/github-sync/app-webhook`（响应安装事件） |

### 创建 GitHub App

进入 **Settings > Developer settings > GitHub Apps > New GitHub App**（个人或组织都行）。

> **Setup URL vs Callback URL**：GitHub App 有两个名字相近、容易混淆的字段。安装流程使用 **Setup URL**——用户安装完成后，GitHub 会带着 `installation_id` 和 `state` 把浏览器跳转到这里。**Callback URL** 用于 OAuth 用户身份识别（"Sign in with GitHub"），Jant 不使用。永远设置 **Setup URL**，留空 Callback URL。

1. **Homepage URL**：你的 Jant 站点
2. **Setup URL (optional)**：`https://<your-jant-site>/settings/github-sync/app/callback`
3. **Redirect on update**：✅ 勾选
4. **Callback URL**：留空
5. **Webhook**：勾选 **Active**，URL 设为 `https://<your-jant-site>/api/github-sync/app-webhook`，**Secret** 填 `GITHUB_APP_WEBHOOK_SECRET` 的值。这样在 App 被卸载、暂停或仓库被移除时，Jant 的安装状态能保持同步。单仓库 push webhook 仍然在站点 host 上自动注册
6. **Repository permissions**：`Contents: Read & write`、`Metadata: Read-only`、`Webhooks: Read & write`
7. **Subscribe to events**：`Push`、`Installation`、`Installation repositories`
8. **Where can this GitHub App be installed**："Only on this account"
9. 生成一个私钥（PKCS#8 PEM），并复制 App ID

## 接下来

- [主题定制](theming.md) —— 调整站点外观
- [导出与导入](export-and-import.md) —— Hugo 导出和站点迁移
- [备份与恢复](backups.md) —— 完整备份策略
- [配置](configuration.md) —— 相关环境变量
