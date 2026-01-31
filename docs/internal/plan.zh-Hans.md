# Jant - 执行计划

> 本文档是开发执行计划，按顺序实施

---

## 阶段 0：项目初始化 ✅

### 0.1 基础设施
- [x] 创建 `pnpm-workspace.yaml`
- [x] 创建 `package.json`（workspace root）
- [x] 创建 `mise.toml`（开发命令）
- [x] 创建 `tsconfig.json`（base config）
- [x] 创建 `.npmrc`

### 0.2 核心包结构
- [x] 创建 `packages/core/package.json`
- [x] 创建 `packages/core/tsconfig.json`
- [x] 创建 `packages/core/wrangler.toml`
- [x] 创建目录结构：
  ```
  packages/core/src/
  ├── index.ts
  ├── app.ts
  ├── types.ts
  ├── db/
  ├── services/
  ├── routes/
  ├── theme/
  ├── lib/
  └── i18n/
  ```

### 0.3 安装依赖
- [x] hono
- [x] drizzle-orm, drizzle-kit
- [x] better-auth
- [x] @lingui/core
- [x] sqids
- [x] marked
- [x] typescript, wrangler
- [ ] BaseCoat UI, Tailwind (待阶段 3)
- [ ] Datastar (待阶段 3)

---

## 阶段 1：数据层 ✅ (核心完成)

### 1.1 数据库 Schema
- [x] `db/schema.ts` - 定义所有表
  - posts, media, collections, post_collections
  - redirects, settings
  - better-auth 相关表（user, session, account, verification）
- [x] `db/migrations/` - 初始迁移文件

### 1.2 类型定义
- [x] `types.ts` - 导出所有类型
  - PostType, Visibility
  - Post, Media, Collection 等实体类型
  - CreatePost, UpdatePost 等操作类型
  - Bindings（Cloudflare 绑定）

### 1.3 工具函数
- [x] `lib/constants.ts` - 保留路径、默认配置
- [x] `lib/sqid.ts` - ID 编码/解码
- [x] `lib/markdown.ts` - Markdown 渲染
- [x] `lib/time.ts` - 时间处理
- [x] `lib/url.ts` - URL/Path 处理

### 1.4 服务层
- [x] `services/post.ts` - 帖子 CRUD + Thread 逻辑
- [x] `services/media.ts` - 媒体上传/管理
- [x] `services/collection.ts` - Collection CRUD
- [x] `services/redirect.ts` - 重定向管理
- [x] `services/settings.ts` - 设置读写
- [ ] `services/search.ts` - FTS5 搜索 (待需要时添加)

---

## 阶段 2：应用骨架 ✅

### 2.1 App 工厂
- [x] `app.ts` - createApp 函数
  - 初始化 Drizzle
  - 初始化 better-auth
  - 注册中间件
  - 挂载路由
- [x] `index.ts` - 导出 createApp

### 2.2 中间件
- [x] 认证中间件
- [x] Onboarding 检查中间件
- [x] 重定向中间件

### 2.3 认证路由
- [x] `routes/auth/` - better-auth 集成
- [x] `/setup` - 首次设置页面
- [x] `/signin` - 登录页面
- [x] `/signout` - 登出

---

## 阶段 3：主题系统 ✅

### 3.1 样式基础
- [x] `theme/styles/main.css` - 使用 BaseCoat + Tailwind
- [x] 下载 Datastar 到 `assets/` 目录

### 3.2 布局组件
- [x] `theme/layouts/BaseLayout.tsx` - HTML 外壳
- [x] `theme/layouts/DashLayout.tsx` - 后台布局

### 3.3 通用组件
- [x] `theme/components/PostList.tsx` - 帖子列表
- [x] `theme/components/PostForm.tsx` - 发布框
- [ ] `theme/components/Pagination.tsx` (待需要时添加)

---

## 阶段 4：前台路由 ✅ (核心完成)

### 4.1 核心页面
- [x] `routes/pages/home.tsx` - 首页 `/`
- [ ] `routes/pages/featured.tsx` - 精选 `/featured` (待需要时添加)
- [x] `routes/pages/post.tsx` - 单帖 `/p/:id`
- [x] `routes/pages/collection.tsx` - Collection `/c/:slug`

### 4.2 索引页面
- [x] `routes/pages/archive.tsx` - 归档 (支持按类型过滤)
- [ ] `routes/pages/search.tsx` - 搜索 (待需要时添加)
- [x] 类型索引通过 `/archive?type=note` 参数实现

### 4.3 动态页面
- [ ] `routes/pages/page.tsx` - 自定义页面 `/*path`

---

## 阶段 5：后台路由 ✅

### 5.1 仪表盘
- [x] `routes/dash/index.tsx` - 仪表盘首页
- [x] `routes/dash/posts.tsx` - 帖子管理 (CRUD)
- [ ] `routes/dash/pages.tsx` - 页面管理 (待需要时添加)
- [x] `routes/dash/collections.tsx` - Collection 管理 (CRUD)
- [x] `routes/dash/redirects.tsx` - 重定向管理
- [x] `routes/dash/settings.tsx` - 设置
- [x] `middleware/auth.ts` - 仪表盘认证保护

### 5.2 API 路由
- [x] `routes/api/posts.ts` - 帖子 API
- [x] `routes/api/upload.ts` - 上传 API (R2)
- [ ] `routes/api/search.ts` - 搜索 API (待需要时添加)
- [ ] `routes/api/settings.ts` - 设置 API (待需要时添加)

---

## 阶段 6：Feed 与 SEO ✅

### 6.1 Feed
- [x] `routes/feed/rss.ts` - RSS/Atom Feed
- [x] `routes/feed/sitemap.ts` - Sitemap + robots.txt

### 6.2 SEO 组件
- [ ] `theme/components/SEO.tsx` - Meta 标签 (可选，待需要时添加)
- [ ] `theme/components/JsonLd.tsx` - 结构化数据 (可选，待需要时添加)

---

## 阶段 7：国际化 ✅

### 7.1 翻译
- [x] `i18n/locales.ts` - 语言定义 (en, zh-Hans, zh-Hant)
- [x] `i18n/i18n.ts` - 翻译运行时 t() 函数
- [x] `i18n/detect.ts` - 语言检测
- [x] `i18n/middleware.ts` - Hono 中间件
- [x] `scripts/extract.ts` - 消息提取脚本
- [x] `lingui.config.ts` - Lingui 配置
- [x] mise 翻译命令 (translate, translate-zh-Hans, translate-zh-Hant)

---

## 阶段 8：模板与 CLI

### 8.1 用户模板
- [ ] `templates/cloudflare/` - Cloudflare Workers 项目模板

### 8.2 CLI（可选，MVP 后）
- [ ] `packages/cli/` - 脚手架工具

---

## 开发顺序建议

1. **先跑起来**：阶段 0 + 阶段 1.1 + 阶段 2.1 → 能启动 dev server
2. **能登录**：阶段 2.2-2.3 → 完成认证流程
3. **能发帖**：阶段 1.4 (post) + 阶段 5.2 (posts API) → 能创建内容
4. **能看帖**：阶段 3 + 阶段 4.1 → 有基本前台
5. **逐步完善**：按需添加其他功能

---

## 里程碑

| 里程碑 | 内容 | 状态 |
|--------|------|----------|
| M1 | 项目可运行 | ✅ dev server 启动，health check 通过 |
| M2 | 认证可用 | ✅ /setup 创建账号，/signin 登录，/dash 需要认证 |
| M3 | CRUD 可用 | ✅ 后台能创建/编辑/删除帖子 |
| M4 | 前台可用 | ✅ 首页、帖子详情页正常显示 |
| M5 | MVP 完成 | ✅ 核心功能可用：帖子、设置、重定向、RSS/Atom、Sitemap |

---

## 已完成功能

- ✅ 项目初始化 (pnpm workspace, TypeScript, Wrangler)
- ✅ 数据库 (Drizzle ORM + D1, 迁移)
- ✅ 服务层 (posts, settings, redirects, media, collections)
- ✅ 认证 (better-auth, 设置页面, 登录/登出)
- ✅ 国际化 (Lingui, 语言检测, 中间件)
- ✅ 主题系统 (BaseCoat + Tailwind, 布局组件)
- ✅ 前台页面 (首页, 单帖页, Collection 页)
- ✅ 后台仪表盘 (帖子管理, Collection 管理, 设置, 重定向)
- ✅ Feed (RSS, Atom, Sitemap, robots.txt)
- ✅ 认证保护 (仪表盘需要登录)
- ✅ 媒体上传 API (R2 存储)

## 待完成功能

- [ ] 搜索功能 (FTS5)
- [ ] 页面管理 (自定义页面，使用 posts type="page")
- [ ] 媒体管理界面 (查看/删除已上传文件)
- [ ] Thread/回复链显示
