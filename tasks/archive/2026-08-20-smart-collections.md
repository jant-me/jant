# Smart Collections（智能合集）

日期：2026-08-20
状态：**已实现**（2026-08-20）。这份文档保留为设计记录——为什么是两张表、为什么永远公开、
为什么没有编辑页、为什么不做 backfill，代码里的注释只写了结论，理由在这里。附录 B 的 11 条
教训对后来的改动仍然有效，其中教训 2（drizzle-kit 重建表引用新列）在这次原样复现了三次。

实现记录见 6 次提交：`539cd1bf`（前置：归档词表收编）、`63faf072`（schema + 服务）、
`457fa35c`（页面 + feed + API）、`e6238d0f`（弹窗 + 目录）、`b56e4feb`（升级 + 存量退役）、
`0a46a470`（枚举面 + 文档 + 词表）。

与文档的偏差，只有一处，且是文档没写到的地方：`/settings/navigation` 的合集选择器也列出了
智能合集（带 `list-filter` 图标区分）。§9 第 15 步的枚举面清单里没有它，但 §1 的表格写着
「能放进导航：是」，只让智能合集页的 ⋯ 菜单能加、设置页不能加，是没理由的不对称。

## 工作方式（作者定，先读这条）

**实现成本不是设计约束。** 这个代码库的每一行都由 AI 写，作者稀缺的是自己的 review
注意力和这份代码的将来，不是 agent 工时。在「便宜的做法」和「好维护、好扩展的做法」
之间一律选后者；不要用「这样改动很大」当反对理由，也不要为了省事缩范围。

具体到这份设计：§4 的维度注册表和 §6 的一条语句计数都比直接写贵，都要照做。

这份文档就是规格。实现时如果发现某条决定站不住，**改文档并写清为什么**，不要默默
偏离。

这个特性有过一版被放弃的实现。**不需要读它才能实现这份文档**——附录 A 是它的位置和
放弃原因，附录 B 是它留下的 11 条教训，**那 11 条务必读**。

**两个前置改动，按顺序做完再开工：**

1. `2026-08-20-1333-archive-directory-legacy-fixes.md`（**已完成**）。修掉了目录计数
   口径、归档 `?collection=` 静默失效、public API 吞 `visibility`，并把两份 schema 里
   9 个本地常量副本收回 `types/constants.ts`——**其中就有第 8 步要改的
   `NAV_ITEM_TYPES`**，不先收回去，那一步会原样重演教训 4。
2. **归档词表收编**（见 §4 末尾，**已完成**）。`src/lib/filter-dimensions.ts` 落地，
   7 个维度各声明一次（`key` / `label` / `url` / `toPostFilter` / `describe`），归档
   页面、feed、chip 栏、public API 四份实现全部改走它。§9 第 1 步只需补上智能合集要的
   `column` / `control` / `schema` 三段。

---

## 1. 是什么

**智能合集是一个成员由条件决定的合集。**

Jant 已经有合集：作者给帖子贴标签，帖子就进去了，可以手工排序和置顶。智能合集是它的
另一半——作者写下条件（「所有引用」「2024 年带图的笔记」），符合条件的帖子自动在里面，
将来发的新帖子也自动进去。

- **对读者**：和合集长得几乎一样。根级地址、标题、描述、帖子列表、自己的 feed。唯一的
  区别是一个图标和一行说明它靠什么收录（§2.2）——这是读者也该知道的信息，它改变你怎么
  读这个合集：手工合集是一句编辑主张，智能合集是一条常驻查询。
- **对作者**：两个不同的手势。合集是**给帖子贴标签**，智能合集是**写条件**。

### 智能合集永远是公开的

**没有 private 智能合集。** 条件里的 `visibility` 只能取
`PUBLIC_ARCHIVE_VISIBILITIES`（public / featured / latest_hidden），不能取 `private`。

这一条删掉的东西比它看起来多得多：页面的 private 守卫、feed 的**第二个**private 守卫、
站点地图排除、三处放置守卫、「条件公开是否安全」的论证、所有列表里的作者可见性过滤——
**全部不存在**。上一版这三个放置守卫曾经漏做过，是后来补的泄漏；少一类守卫就少一次
漏掉它的机会。

概念上也对：合集是公开的东西——有公开地址、有 feed、出现在目录和导航里。「private
合集」是个怪物，一个会 404 的已发布页面。手工合集没有这个概念。

**作者想要一个私密的筛选视图，就去 `/archive` 筛，那个 URL 本来就可以收藏。** 他失去的
只是给它起名字——而私密内容的 feed 本来就不可能存在（feed 按构造是匿名的）。

⚠️ **这不等于私密帖子会漏出来。** 任何公开页面的基础可见性谓词都排除它们，合集页就是
这么做的。规则一句话：**智能合集的每帖可见性规则，和手工合集完全一致**。所以作者登录
时看到的条数可能比匿名多——这和手工合集的合集页是同一个行为。目录计数已经是这个口径
（`listDirectoryCollections` 走 `db/post-visibility.ts` 的共享谓词），智能合集照抄。

### 明确的不对称

`Smart Collection` 这个名字会让人以为两者可以互换。它们不能，而且这笔账是永久的：

|              | 合集           | 智能合集               |
| ------------ | -------------- | ---------------------- |
| 加一篇进去   | 撰写面板里勾选 | **做不到**，条件说了算 |
| 置顶         | 可以           | **做不到**             |
| 手工排序     | 可以           | **做不到**             |
| 排序方式     | 作者选         | 作者选                 |
| 布局         | （目前无）     | 作者选 列表/网格       |
| 出现在目录里 | 是             | 是                     |
| 能放进导航   | 是             | 是                     |
| 每帖可见性   | 基础规则       | **同左，完全一致**     |

所以**每一个「把这篇加进合集」的界面都要排除智能合集**：撰写面板的合集选择器、帖子
菜单的「加入合集」、`/api/collections?view=compose`。iTunes 有一模一样的不对称（歌拖不
进智能播放列表）而没人困惑，先例够；但这条要写进代码注释，否则半年后有人会「顺手
补上」。

### 术语

| 面        | 值                          |
| --------- | --------------------------- |
| 类型      | `SmartCollection`           |
| 服务      | `services.smartCollections` |
| 表        | `smart_collection`          |
| 外键列    | `smart_collection_id`       |
| ID 前缀   | `smc`                       |
| 枚举值    | `'smart_collection'`        |
| API       | `/api/smart-collections`    |
| data 属性 | `data-smart-collection`     |
| 图标      | `list-filter`（lucide）     |
| zh-Hans   | 智能合集                    |
| zh-Hant   | 智慧選集                    |

新增术语先进 `src/i18n/locales/glossary.zh-Hans.yml` / `glossary.zh-Hant.yml`。

图标选 `list-filter` 而不是业界惯例的 `sparkles`：后者在 2026 年读起来就是「AI 味」，
和 Jant「安静的工具、不卖萌」的调性冲突。图标允许具体——`Smart Collection` 这个词承担
概念，图标只需要说「这里有条规则」。图标从 `lucide-static` 按 kebab-case 名字取，任何
lucide 图标都能用，不需要改注册表。

---

## 2. 三个界面

先说用户看到什么，再说底下怎么支撑。

### 2.1 `/collections`：唯一的前门

这是智能合集**唯一**的创建入口。归档页对这个特性一无所知（§5）。

**创建**：`/collections` 页头现有的形状是**一个 `+`（新建合集，链去 `/collections/new`）
加一个 `⋯` 菜单**（`CollectionsManager.tsx`，动作菜单里是 Organize / Add link /
Add divider；`data-collections-action` 的完整值集是 `toggle-menu` / `organize` / `link` /
`divider` / `done`，后两者在 reorder 模式的动作组里再出现一次）。`New Smart Collection`
**加进 `⋯` 菜单**，和 Add link / Add divider 并列。不要加第二个 `+` 按钮——`+` 是手工
合集的创建入口，两个加号会立刻制造「哪个加号」的困惑。

点击打开弹窗（§2.3）。

**建出来就在目录里，这不是一个要实现的步骤。** 合集就是这样的：
`buildDirectoryItems`（`services/collection.ts`）遍历完显式排过序的目录条目之后，
**把所有没出现过的合集追加在末尾**。所以「没放进目录的合集」这个状态根本不存在，
`collection_directory_item` 管的**只是位置**——让它能和分隔线、链接穿插排列并被拖动。

智能合集照抄这条：

- 建出来立刻出现在 `/collections` 末尾，不需要写任何「自动放置」逻辑
- `collection_directory_item.smart_collection_id` 存在**只为了给它一个显式位置**
- **没有「Remove from Collections」这一项**——合集没有，而且删掉目录条目也只是让它掉到
  末尾，并不会让它从页面上消失。给一个做不到它名字所说的事的菜单项是最坏的一种谎
- **不需要「Add smart collection」picker**——没有未放置的东西可加

（上一版给筛选页写了显式放置 + picker + Remove，那是偏离了合集的模型。这次对齐。）

**目录里的行**：和合集条目同一个行布局（序号、标题、描述、线程数），**标题后面多一个
`list-filter` 图标**，`title` / `aria-label` 是条件摘要。图标对**所有人**可见，包括匿名
读者。目录是索引，条件的完整说明在页面上（§2.2），这里不重复。

智能合集条目**不存标题和描述**，从 `smart_collection` 读，所以改名两边一起改。

**条目菜单**：和合集条目的菜单对齐，`Edit` 打开弹窗（§2.3）而不是跳页面。

**排序**：智能合集条目和合集条目在同一个拖拽序列里，统一由
`collection_directory_item.position` 管；sortable 只认 `data-directory-item`，与类型
无关。

### 2.2 智能合集自己的页面

**形状 = 合集页**（`CollectionPage.tsx`）。标题、描述、线程数、feed 链接、帖子列表、
分页。**没有筛选 chip 栏**——合集页没有，它也不该有。

```
Quotes
Things worth keeping.

34 threads · ⌁
Automatically collects Quote · With images →          ← 条件行，所有人可见，可点
```

**条件行**：

- 对**所有人**可见，包括匿名读者。安全性不需要论证：智能合集永远是公开的（§1），条件
  只能由公开信息构成
- 整行是一个链接，指向 `/archive?<条件>`。读者点进去看到同一批帖子，并且可以继续调
  （「这些里面 2024 年的」）。这是**普通导航**，不是耦合——见 §5 的单向规则
- 只列**条件**，不列 `sort` / `layout`（那是呈现，不是成员资格）
- 0 个条件时：`Automatically collects every post.` 真话，而且解释了为什么数字等于全站
  总数
- 文案是 `Automatically collects {conditions}`，`conditions` 由注册表的 `describe`
  拼出来，用空格加中点加空格（`" · "`）连接。**必须走 `values` 占位符**，不要把条件烘进 message 字面量

**作者的动作菜单**：**照抄合集页的 ⋯ 菜单**（`CollectionPage.tsx` 里
`data-collection-page-actions` 那一块），逐项对应：

| 合集页              | 智能合集页                   |
| ------------------- | ---------------------------- |
| `Edit`（跳编辑页）  | `Edit`（**打开弹窗**，§2.3） |
| `Add to navigation` | 同左                         |
| `Edit navigation`   | 同左                         |
| `Delete`（危险项）  | 同左                         |

不要在标题旁边单独放一个 Edit 按钮——合集页没有那种东西，菜单就是这个页面放作者动作的
地方。菜单的开关、键盘、外部点击关闭都复用 `client/collection-page-actions.ts` 的现成
行为。

**排序菜单**：合集页有一个读者可用的 `?sort=` 切换（`collection-sort-option`）。智能
合集同样有，存储的 `sort`（§3）是默认值，URL 参数覆盖它——和合集页的语义一致。选项就是
§3 的四个值；`rating_desc` 的出现门槛照抄合集页（`supportsCollectionRatingSort`：多于
一个有评分的线程才显示，不支持时静默回落 newest）。

**0 条匹配时的空态**：`Nothing matches these conditions yet.` 说清了空的原因；作者在 ⋯
菜单里就能改条件，不需要再写一句「去改条件」。

### 2.3 弹窗：创建和编辑是同一个

**没有编辑页。** `/{path}/edit` 这条路由不存在。三个地方打开同一个弹窗：

1. `/collections` 页头 `⋯` 菜单里的 `New Smart Collection`
2. `/collections` 目录里某条智能合集的菜单 → `Edit`
3. 智能合集页面上作者可见的 `Edit`

```
┌─ New Smart Collection ─────────────────────────────┐
│                                                     │
│  Title      [ Quotes                             ]  │
│  Address    [ quotes                             ]  │
│             jant.me/quotes                          │
│  Description                                        │
│  [                                               ]  │
│                                                     │
│  ── Conditions ──────────────────────────────────   │
│  Posts matching all of these                        │
│                                                     │
│    Format     [ Quote            ▾ ]           ×    │
│    Media      [ Image, Video     ▾ ]           ×    │
│    Replies    [ No replies       ▾ ]           ×    │
│                                                     │
│    + Add condition            34 of 1,240 threads   │
│                                                     │
│  ── Display ─────────────────────────────────────   │
│  Order by   [ Newest first       ▾ ]                │
│  Layout     [ Follow site default ▾ ]               │
│                                                     │
│  Delete smart collection            [Cancel] [Save] │
└─────────────────────────────────────────────────────┘
```

#### 渐进条件行

**不用 field-operator-value（Apple Notes / iTunes 那种）。** 那种形态是给开放条件空间
设计的，用在这里会承诺两件模型给不了的事：

- 加两行 `Format is Note` / `Format is Quote`——那是 OR，而 `format` 是一列
- 顶上的 `Match [all|any]` 开关——全是 AND，`any` 是假的

**要它的形状，不要它的谎**：

- 只显示**已经设了**的维度，每行一个，右侧一个删除
- `+ Add condition` 的菜单列注册表里**还没用掉**的维度；用掉的不出现在菜单里
- 每一行渲染**那个维度自己的控件**（format 三选一，year 年份下拉，media 是
  有/无/按类多选的折叠控件，title 和 replies 两态 any/none，visibility 三选一）。
  控件里**没有「未设」这个选项**——行存在与否已经表达了未设，再给一个选项就是同一状态
  的两个开关
- 每个维度最多一行——这是真话，UI 不该暗示别的
- 顶上一行小字 `Posts matching all of these`，说清是 AND
- 一条条件都没有时：`No conditions yet. Add one to choose what lands here.`
  允许 0 条件保存——那就是「全部帖子」的另一个名字，不是错误

#### 实时计数

`POST /api/smart-collections/preview`，body 就是 create 端点校验的那个 filter 形状（一个
词表，一个校验器），返回 `{ count, baseline }`，显示成 `34 of 1,240 threads`。防抖
250ms。

用 POST 不用 GET：filter 是类型化的 body，走 GET 就要再发明一套 URL 拼法。

**计数是这个弹窗能成立的前提。** 没有它就是一个盲填表单，作者可能存下一个 0 结果的
东西却不知道。如果因为任何原因做不了计数，这个弹窗设计就该重新考虑。

#### 地址

- 实时可用性检查照抄帖子的现成形状 `GET /api/posts/slug`（`routes/api/posts.ts:42-119`，
  `mode=check|suggest`，排除参数是实体 id，返回 `{ slug, available }`）：本特性的端点是
  `GET /api/smart-collections/slug`。合集表单今天**没有**服务端实时检查（纯客户端校验 +
  写入时冲突），帖子那套才是要抄的先例。根命名空间和帖子、合集共享，`path_registry`
  强制唯一
- 从标题自动生成（复用 `client/lazy-slugify.ts`）
- 编辑时改地址是**破坏性**的：旧地址立即失效。给一句明确的提示，不要静默

#### 删除

弹窗底部的危险区。确认文案：`Delete this smart collection? Its address stops working.`

#### 键盘（AGENTS.md 硬要求）

`Escape` 关闭、`Enter` 确认主动作、`Tab` 焦点导航、打开时正确的初始焦点。注意
`<dialog>` 的原生 cancel 事件在内层元素（TipTap/ProseMirror）拦截 keydown 时不触发，
所以除了原生事件之外**还要在组件上直接处理键盘事件**。

#### 「升级成智能合集」：两个入口，同一套东西

同一个严格解析器 + 同一个预填弹窗，服务两处：

1. **目录里的 link**。指向 `/archive?...` 且**完全可解析**时，它的菜单里出现
   `Turn into a smart collection`，预填解析出的条件 + link 原有的标题和描述
2. **Settings 里的 legacy archive 记录**（§7）。同上，预填条件，标题预填成它的路径

打开的是同一个弹窗，作者保存前能看见和调整。

解析器必须**严格**：未知参数、读不出的值、已经不存在的合集、`visibility=private`，一律
拒绝——不给这个入口。升级是在承诺这个页面继续回答这条 link 回答的东西（这和渲染用的
宽松解析器是两个东西，见附录 B 教训 10）。两点精确化：注册表 `url.legacy` 里的旧拼法
（`hasMedia` / `hasTitle` / `hasReplies` / `view`，存量查询串里真实存在）是词表的一部分，
严格解析器**认识它们**，不当未知参数；`sort` / `layout`（含旧名 `view`）是呈现参数，
映射到 §3 的呈现字段预填，同样不算未知。

---

## 3. 数据模型

### 两张表，不是一张

合表看起来很诱人——两者的身份形状完全一样（`path_registry` 行 + title + description，
连 slug 都存在同一个地方）。不做，三个理由：

1. **一半的列对一半的行没有意义**，要靠 check 约束兜着，每个查询都要分支，类型系统帮不
   上忙：一个 `Collection` 类型带 12 个可选字段，每个消费者自己猜。
2. **智能合集可以按合集筛选**（`collection_id` 列，「Books 里的引用」）。合成一张表，这就
   变成自引用，需要防环——为了省两列文本引进一个图问题。
3. `sort_order`（合集内帖子怎么排）和 `sort`（智能合集的排序）语义不同但会撞名。

**相似性放在 read-model，不放在表。** 给 `services.collections` 加一个返回可辨识联合的
列表方法——`{ kind: "manual" | "smart", id, path, title, description, count }`——供
`/collections` 目录、导航选择器、命令面板用。它们确实一视同仁；表不需要为此变形。

### 表定义

```
smart_collection
  id                text PK              -- smc_...
  site_id           text NOT NULL FK → site
  title             text NOT NULL
  description       text

  -- 条件（7 个维度，见 §4）
  format            text                 -- FORMATS
  year              integer              -- 发布年份，见 §4 的 year 特例
  collection_id     text FK → collection(id)          -- 不 CASCADE 不 SET NULL，删除被服务层拦，见下
  media             text                 -- 'any' | 'none' | 逗号连接的 MEDIA_KINDS；NULL = 未设
  has_title         integer/boolean
  has_replies       integer/boolean
  visibility        text                 -- PUBLIC_ARCHIVE_VISIBILITIES，不含 private

  -- 呈现（不是条件）
  sort              text NOT NULL DEFAULT 'newest'    -- newest|oldest|updated|rating_desc
  layout            text                 -- NULL = 跟随站点默认（archiveDefaultLayout）

  created_at        integer NOT NULL
  updated_at        integer NOT NULL
```

`title` 是 **NOT NULL**（合集也是，对齐）。弹窗必填，于是不需要任何「无标题的它在标题栏
/ tab / feed / 目录里各叫什么」的回落逻辑。

`visibility` 用 **`PUBLIC_ARCHIVE_VISIBILITIES`**（`types/constants.ts` 里已经有，
`ARCHIVE_VISIBILITIES` 就是它加上 `private`）。零新常量，check 约束和 Zod 都用它。

`media` 存**一列**，镜像 URL 词表（`media=any|none|<kinds>`），不拆成 `has_media` +
`media_kinds` 两列——两列会制造「`has_media=false` 却列着 kinds」这类不可能状态，还逼着
§4 的注册表为它单开一个跨列接口。`PostFilters` 里确实是 `hasMedia` / `mediaKinds` 两个
字段（`post.ts` 的 `PostFilters`），但那是 `toPostFilter` 的映射，不是存储的事。

`sort` 的取值用**现有词表的原名**。合集页的词表是 `COLLECTION_SORT_ORDERS`
（newest / oldest / `rating_desc`，`types/constants.ts:61-66`——是 `rating_desc` 不是
`rating`）；归档的 `?sort=` 是另一个概念（`published` / `updated` 选的是**时间轴**，
方向都是最新在前，`props.ts:77`），别把两套词表混着当一套。智能合集取
newest / oldest / rating_desc 加 `updated`：前三个映射 `PostFilters.sortOrder`，
`updated` 映射 `sortBy: "thread_updated"`（先例分别在 `collection.tsx` 和
`archive.tsx` 的 `buildArchivePostFilters`）。

**双方言必须同步**：`src/db/schema.ts` 和 `src/db/pg/schema.ts` 两份都改，迁移
`src/db/migrations/` 和 `src/db/migrations/pg/` 两份都生成。忘了 Postgres 那份会静默
丢数据。

### 放置：三处，与 collection 并列

```
path_registry            .smart_collection_id   -- 公开地址，与 post/collection 三选一
collection_directory_item.smart_collection_id   -- type = 'smart_collection'，只管位置
nav_item                 .smart_collection_id   -- type = 'smart_collection'，真正的放置
```

`collection_directory_item` **不是成员资格，是位置**（§2.1）：没有对应条目的智能合集
照样出现在目录末尾。`nav_item` 才是真正可有可无的放置。

导航标题是**活读**的：`nav_item.label` 平时存空串，渲染时 JOIN 目标表取当前标题
（`navigation.ts:167-203`）。smart_collection 要加进 `selectNavItemsWithTargets` 的
JOIN 和 `targetTitleOf`；改地址时照 `collection.ts` 改 slug 时的先例同步重写
`nav_item.url`。这就是 §10「改标题后导航项跟着改」的机制——不要另存标题副本。

约束清单，每一条都要有**直接插真实行**的测试：

- `chk_path_registry_shape` 现在是**按 kind 分支**的（`schema.ts:515-541`）：`slug`/`alias`
  分支的「恰好一个目标外键非空」从二选一改成三选一加入 `smart_collection_id`；`redirect`
  和 `archive` 分支强制它为 NULL
- `uq_path_registry_site_smart_collection_slug`（照
  `uq_path_registry_site_collection_slug` 的形状：(site_id, smart_collection_id)
  WHERE kind='slug'）
- `chk_collection_directory_item_type` 加 `'smart_collection'`；`chk_..._shape` 加对应
  分支——`smart_collection_id` 非空，`label` / `url` / `description` 全空（照 `collection`
  分支）
- `uq_collection_directory_item_site_smart_collection_once`
- `chk_nav_item_type` 加 `'smart_collection'`；`chk_nav_item_shape` 加第五个分支
- `uq_nav_item_site_smart_collection_id`
- **每一支都要求其它外键为空**，包括 `divider` 分支

**放置没有可见性守卫**——智能合集永远是公开的，所以放到哪里都不会给读者一个 404 的
入口。这正是 §1 那一刀买到的东西。

### 引用完整性

**被智能合集引用的合集，删除要被拦住并点名说原因。**

```
Books is used by the smart collection Quotes. Change or delete that first.
```

多于一个时列出名字。**不用 `ON DELETE SET NULL`**：那会让条件静默消失、智能合集悄悄
变宽，而这个项目已经有一条明确的立场——不静默改变作者没主动改的东西。

> **2026-08-21 补记。** 初版实现给 `smart_collection.collection_id` 加了
> `ON DELETE restrict` 当兜底，上线前的 review 把它去掉了——整个外键去掉，不换成别的
> 动作。三种动作没有一种是对的（CASCADE 会因为一个合集没了就删掉一个有地址的页面，
> SET NULL 就是上面否掉的那条），而 RESTRICT 只能报 `FOREIGN KEY constraint failed`，
> 同时把每一条批量删除路径都变成一条没人守的顺序约束——当时三条里有两条是错的，
> 且 SQLite/D1 上不走事务，失败会留下删了一半的站点。点名的拒绝仍然在
> `assertCollectionUnused()`，也就是本节描述的东西；悬空的 id 读出来是「什么都不匹配」，
> 不是「匹配全站」。详见 `tasks/lessons.md`。

---

## 4. 维度注册表

### 为什么要有

七个条件维度，每个都需要：存储列、校验、转成查询条件、弹窗里的控件、读作什么、在归档
URL 里怎么拼。**如果这六件事分别写在六个文件里，同一个词表就存了六份。**

这不是理论风险。这个代码库已经因为一个常量列表存了两份而漏掉一个枚举值，生成出来的
迁移约束是错的（附录 B 教训 4）；而这套 URL 词表本身，归档今天就存着**四份实现**
（见本节末尾）。

### 形状

一个模块 `src/lib/filter-dimensions.ts`，每个维度**声明一次**。命名是中立的、不带
smart-collection 前缀：词表的本体是「帖子筛选维度」，归档收编（见本节末尾）之后
`archive.tsx` 也要 import 它——让归档去 import 一个叫 smart-collection-\* 的模块，读起来
就像打破了 §5 的单向规则，而「两边都依赖共享词表」不是耦合。

```ts
interface Dimension<V> {
  /** 稳定标识，也是弹窗里的行 key */
  key: string;
  /** 存储列名（两个方言同名） */
  column: string;
  /** 值的校验 */
  schema: z.ZodType<V>;
  /** 条件 → PostFilters 的一片 */
  toPostFilter(value: V, ctx: DimensionContext): Partial<PostFilters>;
  /** 弹窗里这一行长什么样 */
  control:
    | { kind: "enum"; options: readonly string[]; labelOf(v: string): MessageDescriptor }
    | { kind: "year" }
    | { kind: "collection" }
    | { kind: "media" } // any / none / 按类多选，折叠词表专用（见特例）
    | { kind: "presence"; yes: MessageDescriptor; no: MessageDescriptor }; // any/none 两态；「未设」= 行不存在
  /** 维度名，和它取某个值时读作什么 */
  label: MessageDescriptor;
  describe(value: V, i18n: I18n, ctx: DimensionContext): string;
  /** 归档 URL 里的拼法，含旧拼法别名 */
  url: { param: string; legacy?: readonly string[]; serialize(...); parse(...) };
}
```

`DimensionContext` 提供跨维度需要的东西（合集 slug↔id 映射、当前 i18n）。

### 四个特例，明写出来

不假装所有维度都一样规整：

- **`media`**：URL、存储、控件用同一个折叠词表（`any|none|image,video`），一列一参数
  一控件；只有 `toPostFilter` 是一对二——`any`/`none` 映射 `hasMedia`，kinds 列表映射
  `mediaKinds`（`PostFilters` 里是两个字段）
- **`year`**：`PostFilters` **没有 year 字段**——归档把它翻成时间戳边界，而且跟着当前
  排序轴走（`archive.tsx` 的 `buildArchivePostFilters`）。智能合集的成员资格不能依赖呈现，所以 `toPostFilter`
  一律钉在发布轴：`publishedAfter` / `publishedBefore`。条件行链出的归档默认
  `sort=published`，在那里 year 也按发布轴解释，点过去仍是同一批帖子
- **`collection`**：URL 里是 slug，存储是 id。`url.parse` 从 `DimensionContext` 取映射，
  读不到就是**解析失败**（不是静默丢弃）
- **`visibility`**：URL 别名 `hidden` ↔ 存储值 `latest_hidden`；取值域是
  `PUBLIC_ARCHIVE_VISIBILITIES`，`private` 解析失败。注意 `featured` 是**虚拟可见性**，
  不是 `post.visibility` 的取值：`toPostFilter` 把它映射成 `{ featured: true }`，其余值
  才映射 `{ visibility }`（归档已有先例：`archive.tsx` 的 `visibilityFilterClause`）

### 谁读它（本次接上的）

- **弹窗**：迭代生成 `+ Add condition` 菜单和每一行的控件
- **Zod**：`CreateSmartCollectionSchema` 由注册表拼出来
- **PostFilters 构造**：迭代已设的维度调 `toPostFilter`
- **计数**（§6）：同上
- **条件行文案**（§2.2）：迭代调 `describe`
- **条件行的链接目标**（§2.2）：迭代调 `url.serialize`
- **「升级链接」**（§2.3）：读 `url.parse`

`url` 这一段对智能合集自身的渲染是不需要的（§5 直连 `PostFilters`），它存在是为了
条件行的链出和升级链接的严格解析。

### 归档的收编是**前置**改动，不是这次的一部分

归档这套 URL 词表存着**四份实现**：页面的宽松解析器（`archive.tsx`
的 `parseArchiveParams`）、public API 的 Zod（`api/public/archive.ts`）、chip 栏的 URL
拼写器（`ArchivePage.tsx` 的 `buildFilterUrl`）、feed 的 self-URL 拼写
（`archive.tsx` 的 `buildArchiveFeedQuery`）。把它们收编到注册表的 `url` 段正是教训 4
的药方。

**这件事排在本特性之前，作为单独一份任务做**，理由三条：

1. 收编在前，两份词表就不会并存，**往返测试这套脚手架根本不用写**（也不用在收编后删掉）
2. 「加第 8 个维度只动 5 处」这条验收会被**归档这个真实消费者**验一遍，接口撑不住会
   立刻暴露，而不是等本特性写到一半才发现
3. `year` 的两种轴（归档跟随排序轴、智能合集钉发布轴）从第一天就有两个真实调用方压着
   `DimensionContext` 的设计

它仍然是**单独一次改动**——归档是回归面最大的读者页，理由同 §8 的「合集编辑转弹窗」：
出问题要能归因。本特性开工时，注册表已经落地并被归档用着。

收编时要一并统一的既有分歧：`?collection=` 在页面上只认单个 slug，在 public API 上认
`tech,art` / `tech+art` 多选。

### 验收：加第 8 个维度要动几处

**5 处**：`db/schema.ts`、`db/pg/schema.ts`、两份迁移、**一条注册表条目**，加 `.po`。
其中 4 处纯机械。更重要的是**同一个词表不可能再存两份**。

实现完 §4 之后，拿一个假想维度（比如 `rating >= n`）在纸上走一遍这五步，确认真的加得
进去、不需要改注册表本身的接口。走不通就说明接口设计错了，先改接口。

---

## 5. 渲染与安全

### 条件直接变成 `PostFilters`

智能合集页不经过归档的渲染器。条件通过注册表的 `toPostFilter` **直接**构造
`PostFilters`，不序列化成查询串再解析回来。

### 归档关系是单向的

> **归档对智能合集一无所知。智能合集可以单向链出到归档（§2.2 的条件行），作为普通
> 导航。**

归档页上**没有**任何和智能合集有关的东西：没有选择器、没有保存按钮、没有来路参数。
`/archive` 是纯读者面。

### 可见性

智能合集页**永远是公开的**（§1）——没有页面守卫，没有 feed 守卫，永远进站点地图。

**每帖**的可见性走基础谓词，规则**和手工合集完全一致**：匿名看不到私密帖子，作者看得到。
所以同一个智能合集，作者看到的条数可能比匿名多——这不是 bug，手工合集也是这样。计数
（§6）用调用方的基础谓词，所以目录里的数字对每个观看者都是对的。

### 爬虫

智能合集页是作者声明的页面，**永远可索引**，进站点地图，有 canonical 和 hreflang。
（上一版要在「作者声明的页」和「读者自己拼的归档 URL」之间做判断，现在这个页面永远是
前者。）

### 其它

- `data-page` 沿用合集页的值，另加 `data-smart-collection="<path>"` 作为区分钩子
- `layout` 决定列表还是网格，存储的 `sort` 是默认顺序；URL 上的 `?sort=` 和 `?page=`
  可以覆盖，语义和合集页一致。**条件类参数一律忽略**——改条件要去弹窗，不是改 URL
- 分页钉在自己的路径上
- feed 在 `/{path}/feed`，self 指向自己
- 语言视图：和合集一样，每种语言一份（`/en/{slug}`），链接要带 `basePath`

---

## 6. 计数：一条语句

### 要求

`/collections` 目录对**两类条目都显示线程数**。手工合集今天已经显示了。

### 口径已经定好了

`listDirectoryCollections` 接收 `CollectionDirectoryViewer`（`isAuthenticated` + `lang`）
并用 `db/post-visibility.ts` 的 `buildReaderVisibilityConditions` 收窄，与合集页同源。
智能合集的计数**必须用同一个谓词**，不要另写一份。

### 不能 N 次并发

一页上 20 个智能合集就是 20 次往返。在 Workers/D1 上往返是主要成本，`Promise.all` 只是
把串行的慢改成并发的贵。**明确否掉。**

### 一条语句的条件聚合

`services/post.ts` 的 `buildFilterConditions`：**每一个筛选条件
都是 `post` 上的 WHERE 谓词，没有一个 JOIN**。合集是 `thread_id IN (SELECT …)`，媒体
kinds 是 `id IN (SELECT …)`，`hasMedia` 走 `EXISTS`，可见性是相关标量子查询
（`effectiveVisibilityExpr`，回落到线程根的可见性），线程根走
`isNull(posts.replyToId)`。所以：

```sql
SELECT
  SUM(CASE WHEN (<谓词_1>) THEN 1 ELSE 0 END) AS "smc_1",
  SUM(CASE WHEN (<谓词_2>) THEN 1 ELSE 0 END) AS "smc_2",
  ...
FROM post
WHERE <站点 + 已发布 + 观看者的基础可见性>
```

一次表扫描，N 个 CASE，**一次往返**。SQLite 和 Postgres 写法相同。

**关键性质：每个 `<谓词_i>` 由同一个 `buildFilterConditions` 生成**，就是单条计数用的
那个。没有第二套谓词词表，不可能漂移。Drizzle 用 `sql` 片段组合。

接口：`services.posts.countMany(filters[], base): Promise<number[]>`。

### 规模与退路

CASE 里的 `EXISTS`（媒体、合集）是相关子查询，逐行逐维度求值。个人微博的量级（帖子数百
到数千）下是毫秒级；而且**无论多少个智能合集都只有一次往返**，这是 Workers 上真正重要的
那个数。

**退路和它的触发条件先写下来**：如果目录查询在真实数据上超过 200ms，换成物化成员表
`smart_collection_member(smart_collection_id, post_id)`，在帖子写入 / 回复增删 /
帖子-合集关系变化时维护。那样计数变成一条 group by，并且顺便让「智能合集也能置顶、
手排」成为可能。代价是一致性义务（需要 `jant rebuild-smart-collections` 和定期校验），
所以**不预先做**。

如果两条路都行不通，诚实的降级是**智能合集不显示数字**。不要为了一个索引页上的数字引进
缓存列和失效逻辑——那是把成本从读挪到写，还多一个会说谎的状态。

---

## 7. 存量：`kind='archive'` 自定义地址

真实站点的 `path_registry` 里有 `kind='archive'` + `archive_query` 的行——Settings →
Custom URLs 里手打查询串建出来的归档地址。它们今天能打开。

### 决定：撤掉创建入口，读取路径无限期保留，**不做任何 backfill**

**先摆正一个事实：读取路径今天已经完整存在，不是要新加的东西。**
`path_registry.archive_query` 列和 `kind='archive'` 的 check 分支在 0012 迁移里已经
发布；`page.tsx:577-582` 就是下面这段代码，一字不差；`services/custom-url.ts:136-157`
是它的写入口。**本次零 schema 改动、零新渲染分支**，改动只有三个：

1. **撤掉创建入口**：`routes/dash/custom-urls.tsx` 里的 `<option value="archive">`
   （`:437-445`）和它的查询串字段（`:497-522`），**加上** `services/custom-url.ts` 的
   create 分支拒绝 `kind='archive'`——只撤 UI 不撤服务，API 照样能建，等于没撤。读取、
   列表、删除保留。
2. **Settings 记录变只读**（带 Archive 徽章、显示 `/archive?...`、可删除）。
3. **加 `Turn into a smart collection`**（见下）。

在设置表单里手打 `format=note&title=none` 是这个特性最初要解决的问题本身，留着创建
入口就是把病灶留在原地。

保留的读取路径（已存在，抄在这里只为说明它有多小）：

```ts
if (resolved.kind === "archive" && resolved.archiveQuery) {
  const overrides = Object.fromEntries(
    new URLSearchParams(resolved.archiveQuery),
  );
  return renderArchivePage(c, overrides);
}
```

这**不是两套并行系统**——归档渲染器为了 `/archive` 本来就必须存在，legacy 分支只是把
一个自定义路径指过去。

### 为什么不做 backfill

1. **转换是拿迁移风险买整洁。** 三个 backfill 加一次后续删列迁移，而 backfill 恰恰是这个
   代码库里 bug 最集中的地方（附录 B 教训 6 就是一个 backfill 撞唯一索引的事故）。
2. **可移植 SQL 提取不出 `year=`**（SQLite 是 `instr`、Postgres 是 `strpos`，没有共同
   拼法），所以转换本来就是部分的，做完还得再写一条把剩下的降级成重定向。
3. **转换会伪造作者没写过的东西。** 转出来的智能合集 `title = path` 是个假标题，然后这个
   假标题的对象出现在目录 picker、命令面板、`/api/smart-collections` 里。作者凭空多出几个
   他没做过的东西，比不动他的旧东西更糟。
4. **样本量小到人做更好。** pre-1.0、自部署、装机量很小。一个人重建几个带真标题的智能
   合集，比可移植 SQL 糟糕地转换它们强得多。
5. **有一类根本无法转换**：智能合集不允许 `private`（§1），而 legacy 地址可以是一个私密
   筛选视图。那些行只能留着——这本身就说明读取路径必须活着。

### 迁移路径：Settings 那一行上的一个按钮

每条 legacy 记录在 Settings 里显示成只读（带 Archive 徽章、显示 `/archive?...`），可以
删除，并多一项 **`Turn into a smart collection`**。

**这和 §2.3 给目录 link 用的是同一套东西**：同一个严格解析器、同一个预填弹窗。一行一次
点击，人来监督，标题是真的。零新机制。

解析不了的行（`year=` 之外还有各种）不显示这一项，和目录 link 的规则一致。

### 退役

**不是现在，可能永远不需要。** 一个可空列、一个枚举值、6 行渲染分支、一个 Settings 只读
分支——收益是纯粹的整洁。真要退役，前提是「退役不可能丢地址」，而到那时升级按钮已经把
大部分排空了；剩下的用一条把 `kind='archive'` 全部改成 302 重定向的可移植 SQL 兜底
（`redirect_to_path = 'archive?' || archive_query`，不带前导斜杠，用 302 不用 301——那是
机械转换不是作者的编辑决定，而且 301 会被浏览器缓存钉死）。`redirect` kind 和它的两列
（`redirect_to_path` / `redirect_type`）都是现成的。

---

## 8. 明确不做

- **private 智能合集**。理由见 §1。作者想要私密的筛选视图就去 `/archive` 筛，那个 URL
  可以收藏
- **归档页上任何和智能合集有关的东西**。`/archive` 是纯读者面
- **编辑页**。创建和编辑都在弹窗里
- **无标题智能合集**（`title` NOT NULL）
- **`language` 条件维度**。语言视图已经在做这件事，`/en/quotes` 自然就是英文的引用；
  再加一个维度会和它打架（`/zh/` 下的「英文合集」该显示什么？）
- **维度内的 OR**（`Format is Note OR Quote`）。将来若要做，`media` 列的 kinds 值已经是
  那个形状——列表值，内部 OR
- **重复条件检测**。两个条件相同但标题、描述、feed 不同的智能合集是合法的；弹窗式创建也
  让误建的可能性很低
- **存量 `kind='archive'` 地址的自动转换**。不写 backfill，理由见 §7；迁移靠 Settings
  里那个升级按钮，一行一次点击
- **物化成员表**（触发条件见 §6）
- 智能合集参与 `/collections/{a+b}` 聚合选择
- Hugo 导出/导入往返
- **归档参数解析的收编**（把 `parseArchiveParams`、public API 的 Zod、`buildFilterUrl`、
  feed 拼写迁到注册表的 `url` 段）。**排在本特性之前**，单独一份任务，见 §4 末尾。所以
  本特性开工时注册表已经存在——§9 第 1 步只是给它补上智能合集要的那几段
- **合集编辑转弹窗**。这个特性落地并验证之后**单独一次改动**做：
  `jant-collection-form.ts` 已经是独立的 547 行 Lit 组件，`CollectionEditorPage.tsx` 只是
  175 行面包屑外壳，而且这个组件已经在 `jant-nav-manager.ts` 里用过了，所以那次基本是净
  删除。不要和这次混在一起，否则出问题没法归因

---

## 9. 实施顺序

每一步单独可验，不要合并。

**开工前**：本地 D1 和本地 PG 都跑过附录 A 那个分支的迁移，必须重置（作者已确认本地库
可弃，没有任何需要保留的数据）：

```bash
rm -rf packages/core/.wrangler/state/v3/d1
# 本地 PG：DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE;
mise run db-wrangler-migrate && mise run db-node-migrate
```

（没有 `db-migrate-local` 这个任务；本地 D1 的迁移任务叫 `db-wrangler-migrate`。）

- [x] 1. **维度注册表**（§4）：补上智能合集要的 `column` / `control` / `schema` 三段。
      注册表本身和它的 `url` / `toPostFilter` / `describe` 已经由前置的归档收编落地，
      归档正在用——**不要重写它，只加段**。纯逻辑，先写测试，不碰数据库不碰 UI。
      写完拿一个假想维度在纸上走一遍五步验收
- [x] 2. **双方言 schema**（§3）+ `drizzle-kit generate` ×2 + **逐行读迁移文件**
      （附录 B 教训 2）
- [x] 3. **类型 / Zod / `ID_PREFIX.smartCollection = "smc"`**，Zod 由注册表拼出来
- [x] 4. **`services/smart-collection.ts`** + 接进 `Services`。含 `toPostFilters()`、
      路径可用性检查、合集删除拦截
- [x] 5. **计数**（§6）。`posts.countMany(filters[], base)` → 一条条件聚合。单独测，含
      0 个、1 个、20 个的情况
- [x] 6. **`routes/api/smart-collections.ts`**：CRUD + `/preview` + `/slug`
- [x] 7. **页面渲染**（§5）。feed、canonical、hreflang、站点地图、空态
- [x] 8. **放置**（§3）：三张表的类型和约束 + **直接插真实行的测试** + 导航标题活读
      （JOIN + `targetTitleOf`）和改地址时的 `nav_item.url` 重写
- [x] 9. **弹窗**（§2.3）。渐进条件行 + 实时计数 + 地址检查 + 删除 + 键盘
- [x] 10. **`/collections`**（§2.1）：`⋯` 菜单里的 New Smart Collection、目录行的
      `list-filter` 图标、条目菜单、计数。**没有「自动放置」要写**——`buildDirectoryItems`
      的末尾追加已经做到了，只要让它认识 smart collection
- [x] 11. **智能合集页**（§2.2）：条件行 + 照抄合集页的 ⋯ 动作菜单（Edit 开弹窗 /
      Add to navigation / Edit navigation / Delete）+ `?sort=` 切换
- [x] 12. **「升级链接」**（§2.3）：严格解析 → 预填弹窗
- [x] 13. **撰写面板排除智能合集**（§1 的不对称），加注释说明为什么
- [x] 14. **存量**（§7）：撤掉 archive 创建入口（**UI 和 service create 分支一起撤**），
      legacy 记录改成只读 + `Turn into a smart collection`（复用第 12 步的解析器和弹窗）
- [x] 15. **枚举面**：站点快照、SQL 导出、站点地图、命令面板、语言视图
- [x] 16. **文案 + 术语表 + `.po` 重新提取**
- [x] 17. **文档**：`writing-and-organizing` 中英、`API.md`、`export-and-import` 中英

---

## 10. 验证清单

- `check-types` / `check-lint` / `check-format` / `check-copy` 全绿
- `check-tests` 全过
- **本地 D1 从零**：`db-wrangler-migrate` 全部迁移 + 既有 backfill（这次不新增）应用成功
- **本地 Postgres 从零**：`DROP SCHEMA public CASCADE` **加 `DROP SCHEMA drizzle CASCADE`**
  之后全部应用成功
- 真机（`dev-debug` + 本地 D1 + 登录 cookie）：
  - `/collections` 的 `⋯` 菜单里有 `New Smart Collection`（`+` 按钮不动）；建完**立刻
    出现在目录末尾**，带 `list-filter` 图标和线程数；拖动它能和合集、分隔线穿插排序
  - 智能合集条目的菜单里**没有** `Remove from Collections`
  - 智能合集页的 ⋯ 菜单和合集页逐项对齐：`Edit`（开弹窗，不跳页）/ `Add to navigation`
    /（已在导航时）`Edit navigation` / `Delete`；`?sort=` 切换可用且默认值来自存储的
    `sort`；URL 上塞条件参数不生效
  - 智能合集的目录计数是**一条聚合查询**（看 SQL 日志确认，不随条目数增长）
  - **目录计数口径**：智能合集的数字和手工合集走同一个谓词——匿名看到的两类数字都
    不含草稿/私密，都随语言视图收窄，并且和各自页面上的数字一致
  - 弹窗：加/删条件、计数随勾随变、地址冲突报错、Escape 关、Enter 保存
  - **弹窗的 visibility 条件里没有 Private 这个选项**；直接 `POST` 一个
    `visibility: "private"` 被 API 拒绝
  - 0 条件的智能合集能建，页面显示全部帖子且条件行说 `every post`
  - 0 条匹配的智能合集页显示空态，不是空白
  - `/quotes` 匿名 200：标题、描述、计数、feed、`list-filter` 图标、**条件行**，**没有
    chip 栏**；条件行链接落到 `/archive?format=quote...` 且是同一批帖子
  - `/quotes/feed` 200，self 指向自己；`/quotes` 进 `sitemap-pages.xml`
  - **私密帖子不漏**：发一篇符合条件的私密帖子，匿名看到的条数不变、列表里没有它；
    作者登录后条数 +1 且能看到——**和手工合集的行为逐条对照一致**
  - 改标题后，目录条目和导航项跟着改
  - 撰写面板的合集选择器里**没有**智能合集
  - 删除一个被智能合集引用的合集：**被拦住**，报错点名那个智能合集
  - 目录里的 `/archive?...` link 菜单出现 `Turn into a smart collection`，点开弹窗**预填了
    条件和标题**；把 URL 改成读不懂的、或带 `visibility=private` 的，这一项消失
  - **存量**：Settings 的自定义地址表单里**没有 Archive 这个类型**；手工插一条
    `kind='archive'` 记录，它的地址仍然 200 且渲染出筛选结果，Settings 里只读可见可删，
    并且出现 `Turn into a smart collection`；点它建出的智能合集地址不变、内容不变；
    再插一条带 `year=` 或 `visibility=private` 的，地址照样 200，但没有升级按钮
- 真机 Postgres（`dev-node` + 本地 PG）：同样的读写路径逐条跑一遍，行为与 SQLite 一致；
  `PG_SMOKE_DATABASE_URL` 配好时顺手 `mise run check-pg-smoke`

---

## 附录 A：被放弃的那一版

分支 `saved-filters-archived`（`a4c73a76`）上有一个**完整、能跑、有约 40 例测试**的实现，
叫 **Saved Filter**。**实现这份文档不需要读它**，但它的 rendering、placement 和完整性
那部分是对的，卡住的时候可以去查具体写法。分支上的
`tasks/todos/2026-08-19-saved-filters.md` 有三个阶段的完整实现记录。

**为什么放弃**：那一版的创作面挂在归档页上。建，要先去 `/archive` 筛；改，要从编辑页跳回
归档、一个 chip 一次整页导航、再从底部操作条存回来——`from=` 和 `returnTo=` 这整套来路
机制存在的唯一目的就是让这趟往返能活下来。**那东西没有自己的前门。** 名字也错了：
`Saved Filter` 说的是它怎么做出来的，而对读者来说它是一个合集。

命名历史：View → Saved Filter → Smart Collection。**第三个，定下来别再动。**（`View` 在
业界偏「显示方式」而这东西 80% 是「选什么」；`Saved Filter` 描述工艺不描述本体；
`Smart Collection` 有 iTunes / Finder / Photos 的强约定，而且它自带一扇门——Collections
页。）

**不要照抄的部分**：归档上的任何创作入口、`from=` / `returnTo=`、errand bar、归档 chip
栏里的选择器、无标题回落、把条件序列化成 URL 再解析回来、以及**所有和 private 可见性
有关的守卫**（新设计里智能合集永远公开，那些守卫全部不需要）。

## 附录 B：11 条教训

全部来自那个分支上的实际事故。**逐条读，不要重新发现。**

1. **迁移是追加式的，永远不要删已生成的迁移。** drizzle 的 PG migrator 按**时间戳**判定
   （`lastDbMigration.created_at < migration.folderMillis`），重新生成会换文件名、时间戳
   更大就重跑，撞 `column already exists`。
2. **drizzle-kit 重建表时会生成 `SELECT "<新列名>"` 引用旧表还没有的列。** 两个方言的
   迁移都要手工改成 `NULL`。生成完必须**逐行读一遍**迁移文件。
3. **重置本地 Postgres 要 `DROP SCHEMA public CASCADE` 加 `DROP SCHEMA drizzle CASCADE`。**
   drizzle 的 journal 在自己的 schema 里，只删 public 会让它以为迁移已应用，下一次从中间
   开始跑。
4. **一个常量列表只能存一份。** 曾经 `db/schema.ts` 里有一份本地的 `NAV_ITEM_TYPES` 和
   `types/constants.ts` 那份分叉了，结果生成的约束漏了一个枚举值。§4 的注册表就是这条
   教训的结构化版本。
5. **放置约束要有直接插真实行的测试。** 那个测试文件一口气抓出 3 个 bug。
6. **backfill 的单条 UPDATE 看到的是更新前状态。** 上一版有两条指向同一路径的目录 link
   同时转换、撞唯一索引。这次不写 backfill（§7），但将来写任何 backfill 都记住这条。
7. **重命名时 SQL 字符串字面量要单独过一遍**——`LIKE '%view=grid%'` 是旧 URL 参数，被
   替换脚本误伤过。
8. **重命名时散文也要单独过一遍。** 词边界替换保得住标识符，保不住句子：`view` 在这个
   代码库里同时是 viewmodel、语言视图和归档布局。上一次留下 17 处叠词（5 处在
   `@context:` 注释里，污染了三份 `.po` 的译者注）和 20 余处替换过头。
9. **服务端投影和客户端从 API 重建的形状可能不一样。** 判断逻辑要读两条路都有的那个
   字段，单元测试的 fixture 要照**服务端真实的投影**写。
10. **宽松解析器不能直接拿来做严格判断。** 渲染用的解析器读不懂就丢掉照样出页面；「这个
    URL 能不能升级成一个持久对象」读不懂就必须拒绝。两个解析器，一个词表。
11. **提升/转换类操作要一次请求写完**，中间失败会留下孤儿。多服务编排放 service 层，另一个
    service 照 `storage?: StorageDriver` 的先例作为**方法参数**传进去。
