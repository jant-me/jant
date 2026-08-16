# 常见问题

## Jant 是开源的吗？

是。完整源码在 [GitHub](https://github.com/jant-me/jant)。托管和自托管运行的是同一份代码，没有"托管专属功能"。

## 自托管和托管怎么选？

| 你的情况                               | 选这个                                |
| -------------------------------------- | ------------------------------------- |
| 想要近乎零成本，能跟着文档配置 15 分钟 | [Cloudflare 自托管](deployment.md)    |
| 已经有自己的服务器和 Docker 经验       | [Docker 自托管](deployment-docker.md) |
| 不想处理任何部署细节                   | [Jant 托管](hosted.md)                |

三条路径运行的是同一份代码。先选托管再迁出，或反过来，都通过 [导出与导入](export-and-import.md) 完成。

## 自定义域名怎么配？

- **托管**：Dashboard → 选中站点 → **域名** → 添加，按提示配置 DNS。证书自动签发与续期。
- **Cloudflare 自托管**：Workers & Pages → 你的 Worker → Settings → Domains & Routes → Add，详见 [部署到 Cloudflare](deployment.md) 中的"绑定自定义域名"。
- **Docker 自托管**：在反向代理里指过来。

## 支持评论吗？

不内置，未来可能会加。现在可以通过 [代码注入](code-injection.md) 嵌入 giscus、Disqus 等第三方系统。

## Jant 有独立页面吗（比如 About 页）？

没有单独的「页面」类型。把一篇标题为 `About` 的 Note 设为 **Hidden from Latest**（从首页隐去），它就是一个独立页面。Jant 用标题生成 slug，地址默认就是 `/about`；想用别的地址，在 **发布** 按钮旁边的 **Publish settings** 面板里展开 **Custom link** 手动填。详见 [写作与内容组织 § 创建独立页面](writing-and-organizing.md#创建独立页面about-页)。

## 怎么发布一篇日期是过去的帖子？

撰写界面里 **发布** 按钮旁边有个 **Publish settings** 面板，把里面的 **Published on** 改成更早的日期即可——帖子会按那个时间排进时间线。常用于补录从别处搬来的旧文章。只能选今天或更早，Jant 不做定时发布。详见 [写作与内容组织 § 发布设置](writing-and-organizing.md#发布设置)。

## 怎么给帖子设一个自己想要的网址？

同一个 **Publish settings** 面板里展开 **Custom link**，发布前填入想要的 slug 即可。如果帖子已经发布、又想换网址，改用 **设置 → 高级 → 自定义 URL**——它会把旧地址自动 301 跳转，不会留下死链。详见 [写作与内容组织 § 自定义 URL](writing-and-organizing.md#自定义-url)。

## 能改主题/外观吗？

三层控制：内建颜色主题、内建字型主题、Custom CSS。Custom CSS 直接覆盖 CSS 变量即可，不需要 fork 主题或重启站点。完整变量列表见 [主题定制](theming.md)。

## 如何升级到新版本？

- **托管**：自动，无需操作。
- **Cloudflare**：`npm install @jant/core@latest && npm run deploy`，迁移会在部署时自动跑。
- **Docker**：`docker compose pull && docker compose up -d`，这个命令会先运行数据库迁移，再启动应用。

升级前建议先做一次完整备份，见 [备份与恢复](backups.md)。

## Cloudflare 免费额度真的够吗？

对一个普通个人博客通常够。Workers 免费层每天 100,000 次请求，R2 免费层 10 GB 存储加每月 100 万次 Class A 操作。一个坑：媒体如果不配 `R2_PUBLIC_URL`，每次图片加载都会走 Worker 中转，免费额度会消耗得更快。配置方式见 [部署到 Cloudflare](deployment.md) 中的"部署后必做清单"。

## 可以带着内容离开吗？

可以，两种方式：

- [`site export`](export-and-import.md#站点导出site-export) —— 一次性导出为标准 Hugo 站点目录（ZIP 或目录），可直接 `hugo serve` 预览。
- [GitHub 同步](github-sync.md) —— 内容始终以 Markdown 持续同步到你自己的 Git 仓库，仓库本身就是一个完整的 Hugo 站点。

## Cloudflare 和 Docker 怎么选？

两边运行的是同一份代码。Cloudflare 适合想要近乎零运维、走免费额度的个人站点；Docker 适合已经有自己服务器和 Docker 经验、或者想要 Postgres / 本地存储的人。两边都新手就选 Cloudflare。详见 [部署到 Cloudflare](deployment.md) 与 [Docker 自托管](deployment-docker.md)。

## 媒体上传有大小限制吗？

非图片默认 1024 MB，可通过 `UPLOAD_MAX_FILE_SIZE_MB` 调整。详见 [配置 § 上传大小限制](configuration.md#上传大小限制可选)。

## 删除的帖子能恢复吗？

不能。删除是永久的——帖子行、对应的路径、所属 Collection 关联以及附件 media 都会被一起清理（正文里嵌入的 inline media 不动）。删帖前 UI 会有二次确认。

## 支持多语言吗？

支持，而且是两件互不相干的事。

**只发布一种语言。** **Settings → Language → Content language** 是你写作使用的语言，它填进 `<html lang>` 和订阅源的 `<language>` 字段——搜索引擎、屏幕阅读器和订阅器读的就是这个。

**同时发布多种语言。** 打开多语言内容后，每种语言在自己的 URL 前缀下拥有独立的首页、归档和订阅源，页头出现切换器，不同语言的帖子可以互相关联为版本。见[多语言内容](multilingual.md)。

后台自己的显示语言是另一回事——**Settings → Language → Dashboard language**，只有你看得到。目前提供 English、简体中文、繁体中文，其他语言回退到 English。

## 支持多作者吗？

不支持。多作者需要权限、审稿、署名、通知等一整套机制，会让产品方向偏向 CMS。需要这些能力，建议考虑 WordPress 或 Ghost。

## 为什么默认 `/feed` 是 Featured 而不是 Latest？

Jant 把"发布到站点"和"广播给订阅者"看成两件事。默认 `/feed` 指向 Featured，让你可以写细碎记录而不打扰订阅者。要换回传统行为，**Settings → General → Feeds → Main RSS feed** 切到 Latest。三条 feed（`/featured/feed`、`/latest/feed`、`/archive/feed`）各管一段，详见 [写作与内容组织 § 为什么默认 feed 是 Featured](writing-and-organizing.md#为什么默认-feed-是-featured)。

## 为什么刚发布的帖子没有立即出现在 RSS 里？

新帖子和回复发布后，Jant 默认留出五分钟的修改时间，再允许它们进入 Atom
feeds。内容会立即显示在网页上，等待的只有 feed 分发。这段时间可以用来修正
错误，或者在 feed 阅读器抓取前撤回内容。

由于 feed 缓存和阅读器各自的轮询周期，实际看到内容的时间可能稍晚。可以在
**Settings → Advanced → Config Editor** 中把 `RSS_PUBLISH_DELAY_SECONDS`
设为 `0–7200` 的整数；设为 `0` 会关闭延迟。详见
[配置 § Feed 默认值](configuration.md#feed-默认值可选)。

## 能挂在子路径下吗（例如 `example.com/blog`）？

可以。设置 `SITE_PATH_PREFIX=/blog`。Cloudflare 还需要在 Workers Routes 里把 `yourdomain.com/blog*` 路由到 Worker。详见 [部署 § 部署在子路径下](deployment.md#部署在子路径下)。

## 反馈渠道？

- [GitHub Issues](https://github.com/jant-me/jant/issues) —— bug 和功能请求
- 邮件 `support#jant.me`（请把 `#` 换成 `@`）—— 托管账户问题

## AI agent 能发帖吗？

可以。两种入口，按场景选：

- **HTTP JSON API**：默认推荐——`POST /api/posts` 加 Bearer token，外部脚本、定时任务、第三方集成都用它。
- **MCP 接口**（`/api/mcp`）：调用方本身就是 MCP client 时。

`create-jant` 生成的项目自带 `AGENTS.md`、`.claude/skills/` 和 `examples/agent-content-automation/`，里面有可以直接复制的 curl 示例。详见 [自动化与 API](automation-and-api.md)。

启用 [GitHub 同步](github-sync.md) 后，AI 也可以直接读写 Git 仓库里的 Markdown——对很多 coding agent 来说比 API 更顺手。

## 能在托管和自托管之间互相迁移吗？

可以，方向都支持。推荐用 `site export` → `site import`：源站点导出为 ZIP，目标站点用空账号导入。全程走 HTTP API，托管与自托管两端都能用，slug 与 URL 会原样保留。详见 [导出与导入](export-and-import.md)。

`site snapshot` 不适用于这一场景。它需要直连数据库与对象存储，托管侧没有这种入口，因此只能用于两端都是自托管、且需要连同内部 ID 与存储 key 一起保留的场景。

## SQLite 和 Postgres 怎么选（Docker 部署）？

单机部署可直接用 SQLite，性能足够、备份只需打包一个文件。已有 Postgres 基础设施时可考虑换 Postgres。切换通过 `DATABASE_URL` 的 scheme 控制（`file:` 或 `postgres:`），见 [配置 § Node 和 Docker](configuration.md#node-和-docker)。

## 在 GitHub 上删了文件，为什么 Jant 里没删？

这是有意的。GitHub 上的文件删除会被同步层忽略，避免误操作导致数据丢失。删帖只能在 Jant UI 里完成，删除后下一次同步会自动从仓库移除对应的 bundle。详见 [GitHub 同步 § 在 GitHub 上编辑](github-sync.md#在-github-上编辑)。

## 在 GitHub 上新建一个 `.md` 文件能创建新帖子吗？

不能。GitHub → Jant 方向只支持更新已有帖子，按 front matter 里的 `slug` 匹配。新增、删除都通过 Jant UI 进行。

## 改了 `AUTH_SECRET` 会怎样？

所有已登录会话立即失效，所有人需要重新登录。生产环境上线后**不要轻易更换**——除非怀疑泄露。生成方式：`openssl rand -base64 32`。

## Pre-1.0，破坏性变更会很多吗？

可能会有，但不到必要不会做。每次破坏性变更都会写在 commit 和 changelog 里。升级前扫一眼变更记录，留一份最近的备份。

## 怎么把别的博客的内容迁进来（WordPress、Tumblr 等）？

没有固定的导入器——每个平台的导出格式都不一样。最省事的办法是把当前站点的 `/skill.md` 地址（例如 `https://example.com/skill.md`）交给 AI 助手。这份绑定当前站点的 Jant 操作指南包含专门的导入流程，讲清楚了数据模型、来源格式映射、断点续跑和迁移验证。把导出文件和站点的 API token 给它，让它来跑这次迁移。详见[导出与导入](export-and-import.md#从别的博客或-cms-迁移过来)。

## 能迁回 WordPress / Ghost 吗？

没有现成路径，但 `site export` 输出的是标准 Markdown + YAML front matter，可以请 AI 写一个一次性转换脚本到 WordPress WXR 或 Ghost JSON。

## 为什么叫 Jant？

来自 _Jantelagen_（扬特法则），北欧文化中"别把自己看得太重"的概念。设计动机见 [简介](overview.md#一种无压力的公开写作)。

## 托管为什么定价 $10.46/年？

我一直喜欢 .com 的定价：$10.46 / 年。

这是 Cloudflare 提供的 .com 域名注册和续费的价格。它略高于免费，又足够正式。不会让开始变得摩擦力太大，但也不是完全没有成本，足够让你把它当回事。

## 接下来

- [简介](overview.md) —— 重新理解 Jant 想解决什么
- [开始使用](getting-started.md) —— 选一条部署路径
- [写作与内容组织](writing-and-organizing.md) —— 站点跑起来之后
