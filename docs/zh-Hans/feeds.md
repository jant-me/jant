# Feed

Jant 站点的每个列表页都发布一个 Atom feed，feed 地址就在所属页面地址后面再加一段。归档页在 `/archive`，它的 feed 就在 `/archive/feed`；地址为 `/reading` 的合集，feed 在 `/reading/feed`。记住这条规则，任何一个 feed 都能找到。

读者不需要记这条规则。`/subscribe` 列出大多数人需要的三个 feed，地址可以直接复制；合集目录里的每个合集、每个带筛选条件的归档视图旁边也都有 feed 图标。想要这两处之外的 feed 时，查本页这张完整的地图。

在「设置 → 常规」里可以彻底关闭 feed。关闭后所有 feed 地址都不再可用，`/subscribe` 消失，导航里的 feed 入口也会移除。

## 全站 feed

| Feed     | 地址             | 内容                                             |
| -------- | ---------------- | ------------------------------------------------ |
| 主 feed  | `/feed`          | 下面两者之一，在「设置 → 常规」里选择            |
| Latest   | `/latest/feed`   | 已发布的帖子，不含 Hidden from Latest 的帖子     |
| Featured | `/featured/feed` | 标为 Featured 的帖子                             |
| 全部     | `/archive/feed`  | 所有已发布的帖子，包括 Hidden from Latest 的帖子 |

`/feed` 跟随你的设置：改了「主 RSS 源」，所有订阅 `/feed` 的人都会开始收到另一个 feed。`/latest/feed` 和 `/featured/feed` 的含义永远不变，想要一个十年后含义依旧的地址，就用它们。

只有 `/archive/feed` 包含 Hidden from Latest 的帖子。这些帖子是公开的，也能访问，只是不出现在首页；归档 feed 给想看全部内容的读者。

## 合集 feed

| Feed         | 地址                      |
| ------------ | ------------------------- |
| 单个合集     | `/{collection}/feed`      |
| 单个智能合集 | `/{collection}/feed`      |
| 多个合集合并 | `/collections/{a+b}/feed` |

合并 feed 包含你列出的任一合集里的帖子，合集之间用 `+` 连接：`/collections/reading+cooking/feed`。

`/collections` 的合集目录没有自己的 feed，它列的是合集，不是帖子。

## 带筛选的归档 feed

归档页的筛选条件会带进它的 feed，所以在 `/archive` 能组合出的视图都可以订阅。先在页面上筛选，再点帖子数旁边的 feed 图标，它指向的地址已经带上了你选的条件。

| 参数         | 示例                               | 作用                           |
| ------------ | ---------------------------------- | ------------------------------ |
| `collection` | `/archive/feed?collection=reading` | 只包含该合集里的帖子           |
| `year`       | `/archive/feed?year=2025`          | 只包含该年份                   |
| `format`     | `/archive/feed?format=quote`       | 只包含笔记、链接或引用         |
| `sort`       | `/archive/feed?sort=updated`       | 按活动时间排序，而不是发布时间 |

归档 feed 默认按发布时间排序，和所属页面一样。`?sort=updated` 改按活动时间排序：一条新回复会把较早的帖子串带回顶部。这样 feed 长度不变，内容却会变动，回到顶部的帖子串会把别的条目挤出去，所以要手动加上这个参数。

`?format=` 也可以用在 `/latest/feed` 上，对 `/feed` 和 Featured feed 不起作用。

## 所有 feed 的共同点

**长度。** 每个 feed 包含最近的 50 个条目，用 `RSS_FEED_LIMIT`（1–200）修改。任何 feed 都接受 `?limit=`，按另一个长度读取一次，最多 500：`/latest/feed?limit=200`。它用来补读一个站点的历史，就像目录第一次读取你的站点时那样；订阅用的仍然是不带它的地址。不是大于零的整数时，这个参数会被忽略。

**发布延迟。** 帖子发布后五分钟内不会进入任何 feed，发布后马上发现的错字就不会出现在别人的阅读器里。用 `RSS_PUBLISH_DELAY_SECONDS` 修改，设为 `0` 则立即进入 feed。

**私密帖子**不会出现在任何 feed 里，草稿也不会。

**帖子串**作为一个条目发布，回复都包含在正文里，不会在阅读器里拆成零散的片段。

**帖子格式。** 每个条目都会声明自己是哪种帖子（`<jant:format>quote</jant:format>`，命名空间 `https://jant.me/ns`），因为在 Atom 里，一条引用和一条没有标题的笔记没有区别。帖子串由根帖子声明。不认识这个命名空间的阅读器会忽略它。

**帖子 ID。** 每个条目还在 `<id>` 旁边带上帖子自己的 ID：`<jant:id>pst_…</jant:id>`。`<id>` 是帖子的地址，改 slug 或把站点迁到另一个域名时会变；ID 永远不变，需要在这两种变化之后认出同一篇帖子时，可以依靠它。

Jant 在条目里加的其他内容，包括帖子串里各个帖子和附件的标记方式，见 [读取 Jant feed（英文）](../feed-reading.md)。

## Feed 与语言

多语言站点的每个 feed 在每种语言下各有一份，位于该语言的前缀下：`/ja/feed`、`/ja/archive/feed`、`/ja/reading/feed`。每份只包含该语言的帖子，并以该语言声明自己。主语言使用不带前缀的地址。见 [多语言内容](multilingual.md)。

## Discover

[Jant Discover](https://jant.me/discover) 是 Jant 博客及其帖子的公开列表。首页显示各博客标为 Featured 的帖子；Links 和 Quotes 列表显示所有链接和引用类型的帖子。每一条都链接回来源博客，没有计数，没有排名，也没有热门榜。

站点要你明确同意才会加入：在「设置 → 常规 → 站点可见性」里开启，或者在首次设置的最后一屏回答同一个问题。不会默认收录：目录从你的 feed 里读取答案，从没被问过的站点也就没有给出答案。演示站点、设了 `RSS_FEEDS_ENABLED=false` 的站点，以及在你自己选择之前设了 `NOINDEX=true` 的站点，不管开关怎么设都不会被收录。

开启后，站点会把 feed 地址发给目录，让目录知道这个站点存在，不发送其他任何内容。关闭 Discover 后重新开启，或者点设置下方的「提交我的站点」时，会再发送一次。在首次设置时回答「是」会当场发送：目录自己决定一个博客需要满足什么条件才会被列出，并按自己的节奏重新读取 feed，所以还没发布内容的站点提早打招呼也没有损失。目录是你的部署所属的那一个：你运行了自己的控制平面时就是它，否则是 Jant 的目录。`DISCOVER_PING_URL` 可以覆盖这一点，设为空则不向任何地方提交。

要把一篇帖子撤出来，就把它从被读取的 feed 里移除：取消 Featured、勾选 **Hidden from Latest**、设为私密，或者改回草稿。目录下次读取 feed 时就会知道；对于 feed 已经不再包含的较早帖子，则是下次询问这篇帖子时知道。

目录如何使用这些 feed 由它自己的规则决定：帖子进入哪个列表、显示前等待多久、博客需要满足什么条件才会被列出，都由目录所在的地方回答。

### Feed 声明了什么

每个 Atom feed 都在头部带上这项设置，所以目录只要持有你的任何一个 feed，就能读到你的选择，不需要另外通知。

```xml
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:jant="https://jant.me/ns" xml:lang="en">
  <title>A blog</title>
  <link href="https://example.com/" rel="alternate"/>
  <link href="https://example.com/latest/feed" rel="self"/>
  <jant:discover feed="https://example.com/latest/feed" featured="https://example.com/featured/feed" status="https://example.com/api/discover/posts">latest</jant:discover>
</feed>
```

目录应遵守的规则：

- 命名空间是 `https://jant.me/ns`。它是一个固定的标识符，不是要访问的地址，绑定它的前缀可以是任意名字。
- 元素的文本是 `latest`、`featured` 或 `none`，其他值应当忽略。`latest` 是这项设置现在写入的值：目录可以读取任何公开帖子。`featured` 是旧版本为只提供 Featured 帖子的站点写入的值；目录应当继续遵守，只读取它指定的那一个 feed。
- `feed` 属性是要轮询的绝对 URL，只在 `latest` 和 `featured` 时出现。只有它和声明它的 feed 同源时才遵守；否则一个站点就能让别人的帖子以自己的名义被列出。
- `featured` 属性是站点 Featured feed 的绝对 URL，在 `latest` 下与 `feed` 并列出现，这样目录可以把 Featured 帖子放在一个列表、全部帖子放在另一个列表，不必猜地址。同源规则同样适用。早于这个属性的 feed 没有它；这时 Featured feed 和 Latest feed 位于同一个基础路径下，`/latest/feed` 对应 `/featured/feed`。
- `status` 属性是目录询问已持有帖子时使用的绝对 URL，见[询问帖子状态](#询问帖子状态)。只要有 `feed` 就有它；在多语言站点上，它以 `?lang=` 带上 feed 的语言。同源规则同样适用。
- **没有这个元素不等于 `none`。** 它表示站点运行的 Jant 版本早于 Discover，这和站点没有被列出是两回事。它也不表示永远同意：声明过一次后又消失的 feed，可能是降级了、feed 模板坏了，或者域名换了主人。元素缺失很久之后（jant.me 等 30 天），目录应当停止列出这个 feed；再次读到带有这个元素的 feed 时，重新列出。
- `none` 表示停止，而且立即停止。它既包括自己退出的站点，也包括从未加入的站点，两者的回答都是否。

多语言站点上，每种语言的 feed 都声明自己，并用 `hreflang` 列出其他语言的 feed。目录无论持有哪一个 feed，都能由此找到双语博客的另一种语言。

有两个细节决定目录看到什么。feed 会缓存一分钟，所以设置改动在下一次未命中缓存的读取时生效。另外，目录应当用 `<jant:id>` 而不是 `<id>` 识别帖子：改 slug 或把站点迁到另一个域名会改变后者，从不改变前者。

### 询问帖子状态

feed 只包含最新的条目，所以一篇帖子不在 feed 里，可能是被撤出了，也可能只是超出了 feed 的长度。永久链接也无法判断：Hidden from Latest 或取消了 Featured 的帖子，页面仍然可以访问。所以目录改为到 `status` 属性给出的地址询问：

```
GET https://example.com/api/discover/posts?id=pst_01jpyx3m7gw4w3h7m4bknq0v1d&id=pst_01jpyx5bq4e0c9t2wq0h6gk3r8
```

```json
{
  "posts": [
    {
      "id": "pst_01jpyx3m7gw4w3h7m4bknq0v1d",
      "latest": true,
      "featured": false
    },
    {
      "id": "pst_01jpyx5bq4e0c9t2wq0h6gk3r8",
      "latest": false,
      "featured": false
    }
  ]
}
```

- `latest` 表示这篇帖子是否在 Latest feed 里，`featured` 表示它所在的帖子串是否在 Featured feed 里。两者都遵循 feed 本身的规则，包括发布延迟。
- 两个都是 `false`，涵盖帖子消失的所有情况：已删除、设为私密、改回草稿，以及站点不认识的 ID。目录不需要知道原因。
- 每个请求最多 50 个 ID，用的是 `<jant:id>` 里的 ID。每个 ID 回答一次，顺序与请求相同。
- 只有站点在 Discover 中被列出时，这个地址才会回答。它跟随这项设置而不是 `PUBLIC_API_ENABLED`，因为它透露的内容不超过公开的 feed。

## 旧地址

这些地址仍然可用，而且会一直可用，谁的订阅都不会失效。新链接用右边的正式地址。

| 旧地址                  | 现在             |
| ----------------------- | ---------------- |
| `/feed/latest`          | `/latest/feed`   |
| `/feed/featured`        | `/featured/feed` |
| `/feed/all`             | `/latest/feed`   |
| `/feed/atom.xml`        | `/feed`          |
| `/{page}/feed/atom.xml` | `/{page}/feed`   |
