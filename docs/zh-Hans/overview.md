# 简介

> **Pre-1.0**：Jant 仍处于早期阶段。会有粗糙的边角和破坏性变更，文档也还在跟着产品调整。
>
> Jant 基于 AGPL-3.0-or-later 协议开源，源码托管于 [GitHub](https://github.com/jant-me/jant)，问题反馈请提交至 [Issues](https://github.com/jant-me/jant/issues)。

Jant 是一个为单作者设计的小型博客系统，支持 **Note、Link、Quote** 三种内容格式，可以串成 Thread，也可以归到 Collection 里。发布体验更接近 Twitter / Threads，而不是 WordPress / Ghost 的后台。

![Jant Home](https://jant-me-media.jant.me/assets/jant-home-800-0816.webp)

在线演示：[demo.jant.me](https://demo.jant.me)。点击 `More` 菜单里的[登录](https://demo.jant.me/signin)直接体验，演示账号已自动填充，数据每日清空。

也可以参考作者本人的博客：[www.owenyoung.com](https://www.owenyoung.com/)。

## 为什么会有 Jant

我一直相信练习写作需要公开表达，只有这样，我们才能让自己的思考变得清晰。但如果每写一条都要推送给 RSS 订阅者，发布的心理门槛就会高很多：一个链接、一句引用、一张随手拍的照片，值得打扰几百个人吗？多数时候答案是不值得，于是要么不写，要么无限推迟。

在 Jant 之前，我用静态网站生成器写博客。Markdown 是一种真正长期的格式，一百年后用最简单的文本编辑器打开照样能读；但是代价是发布太麻烦——新建文件、起名字、写 frontmatter、写正文、commit、push，等部署跑完才能看到效果。所以我分享一些好文章的时候，总是要攒够好几条才会发一次。

我想要一个既具有易读性、又能让作者经常更新的博客系统。但是市面上目前没有这样一个平台，所以我决定自己做一个。

## 发布不等于推送

在 Jant 中，帖子有三种可见性，默认是 Latest：

- **Latest**（默认）：出现在首页时间线，给主动来逛的人看。
- **`Hidden from Latest`**：从首页隐去，链接依然是公开的，也会出现在 `/archive` 和它所属的 Collection 里。
- **Featured**：同时进入`/featured`和 `/feed`，推送给 RSS 订阅者。

我自己的用法是：日常记录选 `Hidden from Latest`，收进一个叫 Now 的合集；真正想让订阅者读到的才标成 Featured。没有这个选项，很多内容我应该并不会发。

## 关于这个名字

Jant 来自 _Jantelagen_（詹代法则）——出自 1933 年的北欧讽刺小说，常被概括为「别炫耀、别攀比」。这个词在北欧语境下偏贬义，被视为压抑个性的集体文化代名词；也有幸福研究者从另一面看它——这种不比较、不打扰的默契构成了北欧社会的底色，也是高幸福感的来源之一。我一直很喜欢这个词，它很适合这样一个希望保持安静的产品。

而当下的社交网络在制造截然相反的压力：

- 一种来自看别人——无处不在的表演与攀比，催生焦虑。
- 一种来自被别人看——帖子被强制推送给所有关注者，让人因心理负担而失去表达欲。

Jant 两样都不做：没有关注者，没有点赞，没有算法信息流。

如果你还没想好要不要写博客，[这篇文章](why-blog.md)或许能给你一个理由。

## 写作体验

传统博客一般会给你提供这样一个管理内容的表单：标题、正文、分类、标签、摘要、SEO、封面图。但是 Jant 借鉴的是更加具有人体工学的 Tumblr / Twitter 界面：博客首页快速发布，标题可选，同时支持 Reply 串成 Thread，这样事后可以持续完善。

Link 和 Quote 是一等格式，不是「文章」的变体。我博客里一半以上的内容是链接和引用，Tumblr 十几年前就发现把它们做成原生格式能让人发得更勤，后来的博客系统却几乎没有跟进。图片、视频、音频也一样：我用 Jant 一个月发的图和视频，比过去一年加起来还多。

常用操作都有快捷键：任意页面按 `n` 新建（`l` 发链接，`q` 发引用），`Cmd + K` 搜索；在帖子页按 `e` 编辑、`f` 加入 Featured、`c` 改合集。正文是 Markdown 编辑器，输入 `/` 唤出命令。

![Jant 撰写界面](https://jant-me-media.jant.me/assets/jant-compose-800-0816.webp)

## Jant 特性

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
