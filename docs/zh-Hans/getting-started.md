# 开始使用

跑起来一个 Jant 站点有三种方式。

| 方式                                      | 适合谁               | 成本              |
| ----------------------------------------- | -------------------- | ----------------- |
| **[Cloudflare 自托管](deployment.md)**    | 想低维护成本长期运行 | 免费额度内通常 $0 |
| **[Docker 自托管](deployment-docker.md)** | 已经有一台服务器     | 取决于你的服务器  |
| **[Jant 托管](hosted.md)**                | 不想碰技术配置       | $10.46/年         |

这三种方式运行的是相同的 Jant，内容随时可以[导出](export-and-import.md)或用 [GitHub 同步](github-sync.md)到你的仓库。

## 不知道选哪个

- **[Cloudflare 自托管](deployment.md)**：需要 Cloudflare 账号，不需要自己的服务器，一次性配置约 15 分钟。
- **[Docker 自托管](deployment-docker.md)**：需要熟悉 Docker，服务器由你自己维护。
- **[Jant 托管](hosted.md)**：部署、升级、备份都由 Jant 官方负责。

## 交给 AI 助手来装

把下面这句话发给 Claude Code、Codex 这类能运行命令的 AI 助手：

```text
读取 https://jant.me/docs/install.md，帮我搭建一个 Jant 站点。
```

这个页面是写给 AI 助手的安装指南。它让 AI 助手先问你选哪种方式，再照对应的文档操作，需要你本人做的步骤（登录 Cloudflare、设置管理员密码等）交回给你。
