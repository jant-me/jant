# 兼容性

从 1.0 起，Jant 遵循[语义化版本](https://semver.org/lang/zh-CN/)：补丁版本修复问题，次版本增加功能，只有大版本才会改动或移除本页列出的内容。1.0 之前，次版本仍可能改动这些内容，改动写在该版本的发布说明里。

## 承诺覆盖的范围

| 范围       | 覆盖的内容                                                                                              | 参考                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| HTTP API   | 接口、请求与响应字段及其行为，`/api/internal/*` 除外                                                    | [API 参考（英文）](../API.md)                                  |
| MCP        | `/api/mcp` 的工具名和参数                                                                               | [自动化与 API](automation-and-api.md)                          |
| Feed       | Feed 地址、Atom 输出，以及 `https://jant.me/ns` 命名空间里的每个名字                                    | [Feed](feeds.md)、[读取 Jant feed（英文）](../feed-reading.md) |
| 地址       | 帖子和合集的 URL、自定义 URL 与重定向、归档页的查询参数                                                 | [写作与内容组织](writing-and-organizing.md)                    |
| 命令行     | `jant --help` 列出的命令及其选项                                                                        | [命令行](cli.md)                                               |
| 配置       | 环境变量、设置项和保留路径                                                                              | [配置](configuration.md)                                       |
| 主题钩子   | 主题定制页列出的 CSS 变量、数据属性和 class                                                             | [主题定制](theming.md)                                         |
| 导出与快照 | 站点导出的 front matter 字段和 `data/jant.toml`，以及快照归档                                           | [导出与导入](export-and-import.md)                             |
| JavaScript | `@jant/core` 的 `createApp`                                                                             | —                                                              |
| 项目结构   | `create-jant` 项目的 `wrangler.toml` 读取的 `@jant/core` 内部路径：`dist/client` 和 `src/db/migrations` | [使用 Cloudflare 部署](deployment.md)                          |
| Docker     | `owenyoung/jant` 镜像、`/var/lib/jant` 数据目录和 `jant-migrate` 服务                                   | [使用 Docker 部署](deployment-docker.md)                       |

## 不在承诺范围内

以下内容任何版本都可能改变：

- `/api/internal/*`。它连接 core 和托管服务，两者一起发布。
- `jant --help` 不列出的命令，也就是构建和运维工具。
- `@jant/core` 里 `createApp` 以外的一切，包括 `@jant/core/i18n` 和 `src/` 下的模块。
- 主题定制页没有列出的 CSS 自定义属性和 class，以及文档化钩子周围的 HTML 结构。
- 导出站点的 Hugo 模板和 partial，以及[导出与导入](export-and-import.md)没有列出的 front matter 字段。
- 数据库结构。迁移在任何版本里都可能改动表和列；读写数据请用 API、命令行或导出。
- 界面文字和翻译。
- 默认值。次版本可能改动默认值（例如 `PAGE_SIZE`），发布说明会写明，并给出恢复旧行为的设置项。

## 新增与移除

- 新增在次版本里发布：新的接口、字段、选项、feed 元素和 CSS 变量。客户端应忽略不认识的字段和元素。
- 大版本移除承诺范围内的东西之前，会先在某个次版本里标为弃用：发布说明和文档写明替代方式，它会一直可用到那个大版本。
- 用户会保存的地址里的旧写法永远可用，包括链接和 feed 订阅，例如 `?hasMedia=1`、`?visibility=latest_hidden`、`/feed/latest`。它们不算弃用，新链接用现在的写法。
- 新的顶层路径如果可能占用你内容已有的地址（`/subscribe` 就是这种情况），只会在大版本里加入。次版本加入顶层路径时，那个地址上已有的内容保持不变。

## 升级

- 0.3.39（2026 年 3 月）及之后安装的站点，可以原地升级到之后的任何版本，可以跨版本：部署时按顺序执行迁移。更早安装的站点早于当前的数据库基线，不要原地升级，建立基线的那次迁移会删除已有数据；先导出内容，再导入到新站点。
- 迁移只能向前。要回到旧版本，恢复升级前的备份，见[备份与恢复](backups.md)。
- 任何 1.x 版本的快照或站点导出，都能导入同一版本或之后的 1.x。由比导入方更新的 Jant 写出的文件，会在写入任何数据之前停止，并提示先升级 `@jant/core`。
- 修复只进入最新的 1.x 版本。
- 托管站点由服务负责升级。
