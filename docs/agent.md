# Jant - 技术规格

> 本文档用于指导 AI 实现。请先阅读 @plan.md 了解产品愿景。

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
├── templates/cloudflare/       # 用户项目模板
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
| `media` | 媒体文件 |
| `collections` | 策展集合 |
| `post_collections` | 帖子-集合关联 |
| `redirects` | URL 重定向 |
| `settings` | 站点设置 |
| `admin` | 管理员信息 |
| `user/session/account/verification` | better-auth 需要 |

### 4.2 Post 字段
```typescript
{
  id: number,
  type: 'note' | 'article' | 'link' | 'quote' | 'image' | 'page',
  visibility: 'featured' | 'quiet' | 'unlisted' | 'draft',
  title?: string,
  slug?: string,           // 自定义 URL
  content?: string,        // Markdown
  content_html?: string,   // 渲染后
  source_url?: string,     // link/quote 的来源
  source_name?: string,
  source_domain?: string,  // 从 URL 提取
  reply_to_id?: number,    // Thread: 直接父帖
  thread_id?: number,      // Thread: 根帖
  deleted_at?: number,     // 软删除
  created_at: number,
  updated_at: number,
}
```

### 4.3 ID 方案

- 数据库使用自增 integer
- URL 使用 Sqids 编码：`/p/jR3k`
- 若有 slug，优先显示 slug：`/p/my-post`

### 4.4 Thread 规则
```
创建回复时：
  reply_to_id = 父帖 ID
  thread_id = 父帖.thread_id ?? 父帖.id

删除时：
  删除 root → 整个 thread 软删除
  删除中间 → 子帖保留，UI 不显示断链占位

可见性：
  Thread 内所有帖子继承 root 的 visibility
```

### 4.5 全文搜索

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
GET  /p/:id               帖子（sqid 或 slug）
GET  /:slug               页面
GET  /c/:slug             Collection
GET  /notes|articles|...  类型索引
GET  /archive             归档
GET  /archive/:year
GET  /search              搜索
GET  /feed                RSS (featured)
GET  /feed/all            RSS (all)
GET  /sitemap.xml
```

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

### 5.5 保留 slug
```
featured, signin, signout, setup, dash, api, feed, search, archive,
notes, articles, links, quotes, media, pages, p, c, static, assets
```

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
AUTH_SECRET = "..."  # 至少 32 字符
```

可在后台修改：`SITE_NAME`, `SITE_DESCRIPTION`, `SITE_LANGUAGE`, `THEME`

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
