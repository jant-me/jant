# 简介

> **Pre-1.0**：Jant 仍处于早期阶段。请预期会有粗糙边角、破坏性变更，以及仍在持续调整的文档。
>
> Jant 基于 AGPL-3.0-or-later 协议开源，源码托管于 [GitHub](https://github.com/jant-me/jant)，问题反馈请提交至 [Issues](https://github.com/jant-me/jant/issues)。

Jant 是一个为单作者设计的小型博客系统，支持 **Note、Link、Quote** 三种内容格式。 Thread，也可以归到 Collection 里。发布体验更接近 Twitter / Threads，而不是 WordPress / Ghost 的后台。

![Jant Home](https://jant-me-media.jant.me/assets/jant-home-800.png)

在线演示：[demo.jant.me](https://demo.jant.me)。点击 `More` 菜单里的[登录](https://demo.jant.me/signin)直接体验，演示账号已自动填充，数据每日清空。

也可以参考作者本人的博客：[www.owenyoung.com](https://www.owenyoung.com/)。

## 一种"无压力"的公开写作

名字来自 _Jantelagen_（詹代法则）——出自 1933 年的北欧讽刺小说，常被概括为"别炫耀、别攀比"。这个词在北欧语境下偏贬义，被视为压抑个性的集体文化代名词；也有幸福研究者从另一面看它——这种不比较、不打扰的默契构成了北欧社会的底色，也是高幸福感的来源之一。

而当下的社交网络在制造截然相反的压力：

- 一种来自看别人——无处不在的表演与攀比，催生焦虑。
- 一种来自被别人看——帖子被强制推送给所有关注者，让人因心理负担而失去表达欲。

大多数博客系统把"已发布"和"已广播"当成同一个决定——发出去就同时进入 RSS、订阅者 feed 和首页时间线。Jant 把发布和推送分开：每篇帖子都可以选择分发方式——不出现在 Latest、出现在 Latest，或标为 Featured 进入 `/feed` 并推送到 RSS。

如果你还没想好要不要写博客，[这篇文章](why-blog.md)或许能给你一个理由。

## 写作体验

传统博客给你一张表单：标题、正文、分类、标签、摘要、SEO、封面图。这是管理内容的界面，不是写东西的界面。Jant 学 Twitter 和 Threads 的做法——标题可选，随时追加成 Thread，发布只有一个动作。

![Jant 撰写界面](https://jant-me-media.jant.me/assets/jant-compose.png)

## Jant 有什么

- 三种格式：Note、Link、Quote
- Threads：连续的想法可以延续，不必凑成长文
- Collections：按主题策展，更像书架而不是标签
- 媒体附件：图片、视频、音频、Markdown、文档、代码片段
- 评分：给书、电影、播客、文章打分
- Featured / Latest 分离：发布不等于推送
- 搜索、归档页、RSS
- 内建主题、字体主题、自定义 CSS
- GitHub 双向同步：每次在 Jant 里编辑都会以 Markdown commit 到你的 GitHub 仓库；在 GitHub 上修改文件也会同步回站点。仓库本身就是一个 Hugo 站点，可独立 `hugo build`，也是完整备份。详见 [GitHub 同步](github-sync.md)。
- API 与 MCP：自动化发布、导入、维护，适合 [AI agent 调用](automation-and-api.md)
- Hugo 静态站点导出：你随时可以[带着内容](export-and-import.md)离开

## 接下来

- [开始使用](getting-started.md) —— 跑起来一个 Jant 博客
- [写作与内容组织](writing-and-organizing.md) —— Note / Link / Quote、Threads、Collections 的具体用法
- [GitHub 同步](github-sync.md) —— 把内容同步到 GitHub 仓库
