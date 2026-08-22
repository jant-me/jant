# Jant

[English](README.md) · [简体中文](README.zh-Hans.md)

> **Pre-1.0**：Jant 仍处于早期阶段。请预期会有粗糙边角、破坏性变更，以及仍在持续调整的文档。
>
> 在线演示：[demo.jant.me](https://demo.jant.me)（演示账号已自动填充，数据每日清空）
>
> 你也可以查看作者的博客作为参考：[www.owenyoung.com](https://www.owenyoung.com/)

Jant 是一个为单作者设计的小型博客系统，支持 **Note、Link、Quote** 三种内容格式。一个想法可以用 Thread 持续展开，也可以归入 Collection 里。发布体验更接近 Twitter / Threads，而不是 WordPress / Ghost 的后台。

![Jant Home](https://jant-me-media.jant.me/assets/jant-home-800-0816.png)

名字来自 _Jantelagen_（詹代法则）——出自一部 1933 年的北欧讽刺小说，常被概括为"别炫耀、别攀比"。

如果你还没想好要不要写博客，[这篇文章](docs/zh-Hans/why-blog.md)或许能给你一个理由。

## 功能

### 发布与推送分离

大多数博客系统把"已发布"和"推送到 RSS"当成同一个决定——发出去就意味着同时进入 RSS。Jant 把发布和推送到 RSS 分开：每篇帖子都可以选择分发方式——不出现在 Latest、出现在 Latest，或标为 Featured 进入 `/feed` 并推送到 RSS。

### 写作体验

传统博客（比如 Wordpress) 会为用户 提供一个后台系统，如果你要发布一片文章，你需要填写一系列表单：标题、正文、分类、标签、摘要和 SEO 等，但是这是企业管理内容的界面，不是个人写东西的界面。Jant 借鉴了 Twitter 和 Threads 的做法——标题可选，随时追加成 Thread，发布只需要一个动作。

![Jant 撰写界面](https://jant-me-media.jant.me/assets/jant-compose-800-0816.webp)

另外，Jant 借鉴了 Tumblr 的一个直觉：Note、Link、Quote 是三种原生格式，不是套在统一文章模板里的子类型。

### GitHub 同步

每次在 Jant 里编辑，内容都会自动以 Markdown commit 到你自己的 GitHub 仓库；在 GitHub 上修改文件也会同步回站点。每篇帖子都拥有完整的 Git 版本历史。

更重要的是，**这个仓库本身就是一个完整的 Hugo 站点**——带主题、配置、导航，可以独立 `hugo build`。一份同步同时是：

- **AI 可读的文件接口**：纯 Markdown 目录比 API 或 MCP 更自然，AI agent 直接读改提交，不需要 API 客户端。
- **完整备份**：脱离 Jant 也能 build 出和站点一致的产物。
- **静态托管的退路**：接 GitHub Actions、Cloudflare Pages、Netlify 任意一个就能当静态站点 host。

详见 [GitHub 同步](docs/zh-Hans/github-sync.md) 和 [导出与导入](docs/zh-Hans/export-and-import.md)。

### 完整列表

- 三种格式：Note、Link、Quote
- Threads：连续的想法可以延续，不必凑成长文
- Collections：按主题策展，更像书架而不是标签
- 媒体附件：图片、视频、音频、Markdown、文档、代码片段
- 评分：给书、电影、播客、文章打分
- Featured / Latest 分离：发布不等于推送
- 搜索、归档页、RSS
- 内建主题、字体主题、自定义 CSS
- GitHub 双向同步：内容自动 commit 到你的仓库，仓库本身就是 Hugo 站点
- API 与 MCP：自动化发布、导入、维护，适合 [AI agent 调用](docs/zh-Hans/automation-and-api.md)
- Hugo 静态站点导出：你随时可以[带着内容](docs/zh-Hans/export-and-import.md)离开

## 部署方式

| 方式                                                   | 适合谁                   | 成本             |
| ------------------------------------------------------ | ------------------------ | ---------------- |
| **[Cloudflare 自托管](docs/zh-Hans/deployment.md)**    | 想用极低维护成本运行的人 | 通常在免费额度内 |
| **[Docker 自托管](docs/zh-Hans/deployment-docker.md)** | 有自己服务器的人         | 你的服务器成本   |
| **[Jant 托管](docs/zh-Hans/hosted.md)**                | 不想处理部署的人         | $10.46 / 年起    |

三种方式跑的是同一份开源代码，内容可以通过 [导入导出](docs/zh-Hans/export-and-import.md) 或 [GitHub 同步](docs/zh-Hans/github-sync.md) 迁移。

## 快速开始

### 部署到 Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jant-me/jant-starter)

最快的路径是用 Cloudflare 一键部署按钮——它会从 Jant starter 仓库开始，引导你填写所需字段。完整说明见 [使用 Cloudflare 部署](docs/zh-Hans/deployment.md)。

### 用 CLI 创建

```bash
npm create jant@latest my-site
cd my-site
npm run dev
```

打开 `http://localhost:3000`，在浏览器里完成初始设置。

### 使用 Docker 部署

- Docker 镜像：[`owenyoung/jant`](https://hub.docker.com/r/owenyoung/jant)
- 指南：[使用 Docker 部署](docs/zh-Hans/deployment-docker.md)

### 使用 Jant 托管

官方托管 [jant.me](https://jant.me) 和自托管跑的是同一份代码，额外提供自动 HTTPS、自定义域名和媒体存储。详见 [使用 Jant 托管](docs/zh-Hans/hosted.md)。

## 文档

### 开始

- [为什么今天仍然值得写博客？](docs/zh-Hans/why-blog.md)
- [简介](docs/zh-Hans/overview.md)
- [开始使用](docs/zh-Hans/getting-started.md)

### 运行你的站点

- [使用 Cloudflare 部署](docs/zh-Hans/deployment.md)
- [使用 Docker 部署](docs/zh-Hans/deployment-docker.md)
- [使用 Jant 托管](docs/zh-Hans/hosted.md)
- [配置](docs/zh-Hans/configuration.md)

### 使用你的站点

- [写作与内容组织](docs/zh-Hans/writing-and-organizing.md)
- [GitHub 同步](docs/zh-Hans/github-sync.md)
- [主题定制](docs/zh-Hans/theming.md)
- [代码注入](docs/zh-Hans/code-injection.md)

### 数据与集成

- [导出与导入](docs/zh-Hans/export-and-import.md)
- [备份与恢复](docs/zh-Hans/backups.md)
- [自动化与 API](docs/zh-Hans/automation-and-api.md)

### 参考

- [常见问题](docs/zh-Hans/faq.md)
- [API 参考（英文）](docs/API.md)

## 开发

Jant 仓库使用 [mise](https://mise.jdx.dev/) 管理开发依赖和任务。

```bash
git clone https://github.com/jant-me/jant.git
cd jant
mise install
pnpm install
mise run dev
```

贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

AGPL-3.0-or-later
