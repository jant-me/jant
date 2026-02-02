# Jant - 技术规格

> 本文档用于指导 AI 实现。请先阅读 plan.zh-Hans.md 了解产品愿景。

---

## 一、技术栈

| 组件 | 选型 |
|------|------|
| 运行时 | Cloudflare Workers |
| 框架 | Hono |
| 前端交互 | Datastar |
| 模板 | hono/jsx |
| 样式 | BaseCoat UI + Tailwind（仅布局） |
| 数据库 | D1 + Drizzle |
| 认证 | better-auth |
| i18n | @lingui/core |
| 包管理 | pnpm monorepo |
| 任务管理 | mise |

---

## 二、项目结构
```
jant/
├── packages/
│   ├── core/                   # @jant/core
│   │   └── src/
│   │       ├── index.ts        # 导出 createApp
│   │       ├── app.ts          # Hono app 工厂
│   │       ├── types.ts        # 类型定义
│   │       ├── db/
│   │       │   ├── schema.ts   # Drizzle schema
│   │       │   └── migrations/
│   │       ├── services/       # 业务逻辑
│   │       ├── routes/
│   │       │   ├── pages/      # 前台
│   │       │   ├── dash/       # 后台
│   │       │   ├── api/
│   │       │   ├── feed/
│   │       │   └── auth/
│   │       ├── theme/
│   │       │   ├── components/
│   │       │   ├── layouts/
│   │       │   └── styles/
│   │       ├── lib/            # 工具函数
│   │       └── i18n/
│   │
│   └── cli/                    # @jant/cli
│
├── templates/jant-site/       # 用户项目模板
├── mise.toml                   # 所有开发命令
└── pnpm-workspace.yaml
```

---

## 三、架构原则

1. **单文件单职责**：每文件 < 300 行
2. **显式依赖**：通过参数传入，不用全局状态
3. **类型即文档**：完整 TypeScript 类型 + Zod 验证
4. **约定优于配置**：固定目录结构，统一命名

---

## 四、数据模型

### 4.1 核心表

| 表 | 用途 |
|---|------|
| `posts` | 所有内容（note/article/link/quote/image/page） |
| `media` | 媒体文件元数据 |
| `collections` | 策展集合 |
| `post_collections` | 帖子-集合关联（多对多） |
| `redirects` | URL 重定向 |
| `settings` | 站点设置（Key-Value） |
| `user/session/account/verification` | better-auth 表（复用 user 表做 admin）|

### 4.2 Post 字段
```typescript
{
  id: number,
  type: 'note' | 'article' | 'link' | 'quote' | 'image' | 'page',
  visibility: 'featured' | 'quiet' | 'unlisted' | 'draft',
  title?: string,
  path?: string,           // 自定义 URL 路径（支持多级，如 about/team）
  content?: string,        // Markdown（使用 marked 渲染）
  content_html?: string,   // 渲染后 HTML
  source_url?: string,     // link/quote 的来源
  source_name?: string,
  source_domain?: string,  // 从 URL 提取
  reply_to_id?: number,    // Thread: 直接父帖
  thread_id?: number,      // Thread: 根帖
  deleted_at?: number,     // 软删除
  published_at: number,    // 用户可编辑的展示时间（只允许过去时间）
  created_at: number,      // 真实创建时间（系统自动）
  updated_at: number,
}
```

**URL 规则**：
- 非 page 类型：默认 `/p/{sqid}`，用户可设置 path，修改后旧路径自动 301 重定向
- page 类型：用户必须填写 path（支持多级路径如 `about/team`）

### 4.3 Media 字段
```typescript
{
  id: number,
  post_id?: number,        // 可选，media 可独立存在（先上传后使用）
  filename: string,        // 存储文件名
  original_name: string,   // 原始文件名
  mime_type: string,
  size: number,            // 字节
  r2_key: string,          // R2/S3 对象键
  width?: number,          // 图片宽度
  height?: number,         // 图片高度
  alt?: string,            // 无障碍描述
  created_at: number,
}
```

### 4.4 Collections 字段
```typescript
{
  id: number,
  slug: string,            // URL: /c/{slug}，唯一
  title: string,
  description?: string,
  created_at: number,
  updated_at: number,
}
```

### 4.5 Post_Collections 字段
```typescript
{
  post_id: number,         // FK → posts.id
  collection_id: number,   // FK → collections.id
  added_at: number,
  // PRIMARY KEY (post_id, collection_id)
  // 一个帖子可属于多个 Collection
}
```

### 4.6 Settings 字段
```typescript
{
  key: string,             // PRIMARY KEY，与环境变量命名一致
  value: string,           // JSON 序列化
  updated_at: number,
}
// 例：SITE_NAME, SITE_DESCRIPTION, SITE_LANGUAGE, THEME, ONBOARDING_STATUS
```

### 4.7 Redirects 字段
```typescript
{
  id: number,
  from_path: string,       // 源路径，如 /old-post
  to_path: string,         // 目标，可以是相对路径或完整外部 URL
  type: 301 | 302,         // 永久 vs 临时
  created_at: number,
}
// 用途：1) slug 变更时自动创建  2) 手动创建自定义重定向
```

### 4.8 ID 与 URL 方案

- 数据库使用自增 integer
- URL 使用 Sqids 编码：`/p/jR3k`
- 若有 path，优先显示 path：`/p/my-post`
- path 变更时自动创建 301 重定向到新路径

### 4.9 Thread 规则
```
创建回复时：
  reply_to_id = 父帖 ID
  thread_id = 父帖.thread_id ?? 父帖.id
  visibility = 复制 root 的 visibility

删除时：
  删除 root → 整个 thread 软删除
  删除中间 → 子帖保留，UI 不显示断链占位

可见性（创建时复制 + 级联更新）：
  - 创建子帖时：复制 root 的 visibility
  - 修改 root visibility 时：级联更新所有子帖
  - 理由：查询性能好 + 符合「Thread 是一个整体」的语义
```

### 4.10 全文搜索

使用 FTS5 trigram：
```sql
CREATE VIRTUAL TABLE posts_fts USING fts5(
  title, content,
  content=posts, content_rowid=id,
  tokenize='trigram'
);
```

需要触发器保持同步。

---

## 五、路由

### 5.1 前台
```
GET  /                    首页
GET  /featured            精选
GET  /p/:id               帖子（sqid 或 path）
GET  /c/:slug             Collection
GET  /notes|articles|...  类型索引
GET  /archive             归档（仿 Tumblr，按月份无限滚动）
GET  /archive/:year
GET  /search              搜索
GET  /feed                RSS/Atom (featured，最近 N 篇)
GET  /feed/all            RSS/Atom (all public)
GET  /sitemap.xml         自动生成，包含所有公开帖子和页面
GET  /*path               页面（page 类型，支持多级路径，最低优先级）
```

**分页**：Cursor-based + 无限滚动，默认每页 100 项（可配置）

### 5.2 认证
```
GET  /setup               首次设置
GET  /signin              登录
GET  /signout             登出
ALL  /api/auth/*          better-auth
```

### 5.3 后台
```
GET  /dash                仪表盘
GET  /dash/posts          帖子管理
GET  /dash/pages          页面管理
GET  /dash/collections    Collection 管理
GET  /dash/redirects      重定向管理
GET  /dash/settings       设置
```

### 5.4 API
```
GET    /api/posts
GET    /api/posts/:id
POST   /api/posts           [auth]
PUT    /api/posts/:id       [auth]
DELETE /api/posts/:id       [auth]
POST   /api/upload          [auth]
GET    /api/search?q=
GET    /api/settings        [auth]
PUT    /api/settings        [auth]
```

### 5.5 保留路径
```
featured, signin, signout, setup, dash, api, feed, search, archive,
notes, articles, links, quotes, media, pages, p, c, static, assets
```
> 保留路径列表可配置（通过 `lib/constants.ts` 导出）。
> Page 创建/更新时需验证 path 不与保留路径冲突。

---

## 六、样式规范

### 6.1 BaseCoat 为主
```html
<!-- ✅ 使用 BaseCoat 组件类 -->
<button class="btn btn-primary">发布</button>
<input class="input" />
<div class="card">...</div>

<!-- ✅ Tailwind 仅用于布局 -->
<div class="flex gap-4 mt-2">...</div>

<!-- ❌ 不要用 Tailwind 重建组件 -->
<button class="bg-blue-500 px-4 py-2 rounded">...</button>
```

### 6.2 CSS 变量

颜色主题通过 CSS 变量实现，支持 light/dark mode：
```css
:root {
  --color-bg, --color-text, --color-accent, --color-border, ...
}
```

### 6.3 动画
```css
--transition-fast: 150ms ease-out;
--transition-base: 200ms ease-out;
```

---

## 七、microformats2

所有帖子使用 `h-entry` 标记：
```html
<article class="h-entry">
  <h2 class="p-name">标题</h2>
  <div class="e-content">内容</div>
  <a class="u-url" href="...">永久链接</a>
  <time class="dt-published" datetime="...">时间</time>
  <a class="p-author h-card" href="/">作者</a>
</article>
```

Link 类型额外加 `u-bookmark-of`，Quote 类型用 `h-cite`。

---

## 八、开发命令（mise.toml）
```toml
[tasks.dev]
run = "pnpm --filter @jant/core exec wrangler dev"

[tasks."db:generate"]
run = "pnpm --filter @jant/core exec drizzle-kit generate"

[tasks."db:migrate"]
run = "pnpm --filter @jant/core exec wrangler d1 migrations apply DB --local"

[tasks.deploy]
run = "pnpm --filter @jant/core exec wrangler deploy"

[tasks.lint]
run = "pnpm turbo lint"

[tasks.typecheck]
run = "pnpm turbo typecheck"
```

---

## 九、环境变量
```bash
# wrangler.toml [vars]
SITE_URL = "https://example.com"

# wrangler secret
AUTH_SECRET = "..."           # 至少 32 字符

# 存储配置（必须配置，否则上传报错）
R2_BUCKET = "jant-media"      # Cloudflare R2 bucket 名称
R2_PUBLIC_URL = "https://..."  # R2 公开访问 URL

# 可选：Cloudflare Images（推荐，自动处理缩放/格式转换）
CF_IMAGES_ACCOUNT_ID = "..."
CF_IMAGES_API_TOKEN = "..."
```

**存储策略**：
- Cloudflare 部署默认使用 R2（S3 兼容，无出口费用）
- 图片处理推荐接入 Cloudflare Images（自动缩放、WebP 转换）
- 未配置存储时，上传功能报错，/dash/settings 页面显示配置提示

可在后台修改（存入 settings 表）：`SITE_NAME`, `SITE_DESCRIPTION`, `SITE_LANGUAGE`, `THEME`

---

## 十、实现顺序
```
Phase 1: 基础
  db/schema.ts → types.ts → lib/*.ts → services/*.ts → app.ts

Phase 2: 前台
  styles/ → layouts/ → components/ → routes/pages/

Phase 3: 后台
  routes/auth/ → routes/dash/ → routes/api/

Phase 4: 完善
  routes/feed/ → i18n/ → 更多主题
```

---

## 十一、关键约定

1. **Service 模式**：所有数据库操作封装在 service 中
2. **Context 传递**：通过 `c.var.services`, `c.var.config` 访问
3. **软删除**：posts 使用 `deleted_at` 软删除
4. **时间戳**：使用 Unix timestamp (integer)
5. **Slug 变更**：自动创建 301 重定向
6. **Admin 认证**：复用 better-auth 的 user 表，通过 role 字段标识 admin

---

## 十二、Onboarding 流程

```
1. 首次访问任意页面 → 检查 settings.ONBOARDING_STATUS
2. 如果 'pending' 或不存在 → 重定向到 /setup
3. /setup 页面收集：
   - 管理员账号（邮箱 + 密码）
   - 站点名称
   - 站点语言
4. 完成后 → ONBOARDING_STATUS = 'completed'
5. /dash/settings 页面显示存储配置状态和提示
```

---

## 十三、时间显示

- **1 个月内**：显示相对时间（如「3小时前」），hover 显示本地时区具体时间（JS）
- **超过 1 个月**：服务端渲染 UTC 日期
- 使用 `<time datetime="...">` 语义化标签

---

## 十四、SEO 与社交分享

```html
<!-- 必须 -->
<title>{标题} | {站点名}</title>
<meta name="description" content="{描述}">
<link rel="canonical" href="{完整 URL}">

<!-- Open Graph -->
<meta property="og:title" content="{标题}">
<meta property="og:description" content="{描述}">
<meta property="og:image" content="{帖子第一张图，没有则不输出}">
<meta property="og:url" content="{完整 URL}">

<!-- Twitter Cards -->
<meta name="twitter:card" content="summary_large_image">
...

<!-- JSON-LD 结构化数据 -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  ...
}
</script>
```

**标题/描述回退**：若帖子无标题，取正文第一行或前 120 字（取最小）

---

## 十五、编辑器

- Article 编辑器参考 Pika.page 风格
- 支持直接粘贴图片（自动上传到 R2）
- 使用标准 Markdown 语法嵌入图片
- 提供插入图片按钮简化操作
