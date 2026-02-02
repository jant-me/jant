# Jant 架构设计

> 本文档描述 Jant 的整体架构设计，包括包结构、升级策略和主题定制机制。

---

## 一、设计原则

1. **Core 是单一真相来源** - 所有业务逻辑、路由、组件、数据库 schema 都在 `@jant/core`
2. **Template 保持最小化** - 用户项目只包含配置和自定义覆盖
3. **升级应该简单** - 一条命令完成升级，无需手动合并代码
4. **主题可覆盖** - 用户可以轻松覆盖任何主题组件

---

## 二、包结构

```
jant/
├── packages/
│   ├── core/                    # @jant/core - 核心库
│   │   ├── src/
│   │   │   ├── index.ts         # 导出 createApp, 类型, 工具函数
│   │   │   ├── app.tsx          # Hono app 工厂
│   │   │   ├── types.ts         # 所有类型定义
│   │   │   ├── db/
│   │   │   │   ├── schema.ts    # Drizzle schema
│   │   │   │   └── migrations/  # 数据库迁移文件
│   │   │   ├── services/        # 业务逻辑层
│   │   │   ├── routes/          # 所有路由
│   │   │   ├── theme/           # 默认主题
│   │   │   │   ├── components/  # 可覆盖的组件
│   │   │   │   ├── layouts/     # 布局组件
│   │   │   │   └── styles/      # 样式
│   │   │   ├── lib/             # 工具函数
│   │   │   └── i18n/            # 国际化
│   │   └── package.json
│   │
│   └── create-jant/             # create-jant CLI
│       ├── src/index.ts         # CLI 逻辑
│       └── package.json         # 不含 template/，从 templates/ 复制
│
├── templates/
│   └── cloudflare/              # Cloudflare Workers 模板
│       ├── src/
│       │   ├── index.ts         # 入口：配置 + createApp()
│       │   └── theme/           # [可选] 用户主题覆盖
│       ├── wrangler.toml
│       ├── package.json         # 依赖 @jant/core
│       ├── tsconfig.json
│       └── .dev.vars.example
│
└── docs/
```

---

## 三、用户项目结构（模板生成）

用户通过 `pnpm create jant my-site` 创建的项目结构：

```
my-site/
├── src/
│   ├── index.ts                 # 入口文件：配置 + createApp()
│   └── theme/                   # [可选] 主题覆盖
│       └── components/          # [可选] 覆盖特定组件
│           └── PostCard.tsx     # 示例：覆盖帖子卡片组件
├── migrations/                  # 数据库迁移（从 @jant/core 同步）
│   ├── 0000_initial.sql
│   └── ...
├── wrangler.toml                # Cloudflare 配置
├── package.json                 # 依赖 @jant/core
├── tsconfig.json
└── .dev.vars                    # 环境变量（不提交）
```

**关键点：用户项目非常精简**
- `src/index.ts` - 唯一必须的源文件，调用 `createApp()` 并传入配置
- `migrations/` - 由升级命令自动同步，用户无需手动管理
- `theme/` - 仅当需要覆盖组件时才创建

### 入口文件示例

```typescript
// src/index.ts
import { createApp } from "@jant/core";

export default createApp({
  // 站点配置
  site: {
    name: "My Blog",
    description: "A personal blog",
    language: "en",
  },

  // [可选] 主题覆盖
  theme: {
    // 覆盖特定组件
    components: {
      // PostCard: () => import("./theme/components/PostCard"),
    },
  },
});
```

---

## 四、设计决策

### 4.1 迁移文件位置：用户项目

**决策：** 迁移文件存放在用户项目的 `migrations/` 目录，由升级命令从 `@jant/core` 同步。

**参考：**
- [Payload CMS](https://payloadcms.com/docs/database/migrations) - 迁移在用户项目，提交到 git
- [Drizzle + D1](https://orm.drizzle.team/docs/connect-cloudflare-d1) - Wrangler 需要本地路径

**原因：**
1. Wrangler 的 `d1 migrations apply` 需要本地文件路径
2. 迁移文件应该提交到 git，是项目历史的一部分
3. 用户可以查看/审计迁移内容
4. 支持用户添加自己的扩展迁移

### 4.2 主题覆盖：Astro Starlight 模式

**决策：** 采用配置注入方式，用户在 `createApp()` 中显式指定要覆盖的组件。

**参考：**
- [Astro Starlight](https://starlight.astro.build/guides/overriding-components/) - 配置注入，显式覆盖
- [shadcn/ui](https://ui.shadcn.com/) - 复制代码（不采用，无法升级）
- [Ghost CMS](https://docs.ghost.org/themes) - 完整主题（不采用，学习曲线高）

**原因：**
1. **显式覆盖** - 清楚知道哪些组件被覆盖
2. **类型安全** - Props 接口由 Core 定义，IDE 自动补全
3. **渐进式** - 只覆盖需要的，其他使用默认
4. **可升级** - 升级 Core 不影响用户自定义组件
5. **可组合** - 可以导入默认组件进行扩展或包装

---

## 五、升级策略

### 5.1 升级命令

用户只需运行一条命令即可完成升级：

```bash
pnpm jant upgrade
# 或
npx @jant/cli upgrade
```

### 5.2 升级流程

```
┌─────────────────────────────────────────────────────────────┐
│                      pnpm jant upgrade                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. 更新 @jant/core 到最新版本                                │
│    pnpm update @jant/core                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. 同步迁移文件                                              │
│    从 node_modules/@jant/core/migrations/ 复制新文件到       │
│    用户项目的 migrations/ 目录                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. 执行数据库迁移                                            │
│    wrangler d1 migrations apply DB --local                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. 显示升级完成提示                                          │
│    - pnpm dev    启动本地开发                                │
│    - pnpm deploy 部署到 Cloudflare                          │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 迁移文件管理

**Core 包结构：**
```
@jant/core/
├── src/
│   └── db/
│       ├── schema.ts
│       └── migrations/          # 迁移文件的源
│           ├── 0000_initial.sql
│           ├── 0001_add_fts.sql
│           └── ...
└── package.json
```

**用户项目：**
```
my-site/
├── migrations/                  # 从 core 同步的迁移文件
│   ├── 0000_initial.sql
│   ├── 0001_add_fts.sql
│   └── ...
└── wrangler.toml               # migrations_dir = "migrations"
```

**同步逻辑：**
- 比较 core 和用户项目的迁移文件
- 只复制用户项目中不存在的新迁移
- 不修改或删除已存在的迁移文件
- 保持迁移文件的编号顺序

---

## 六、主题定制机制

### 6.1 设计目标

- 用户可以覆盖任何组件，而不需要 fork 整个项目
- 覆盖是可选的，不覆盖则使用 core 的默认实现
- 升级 core 不会破坏用户的自定义组件

### 6.2 可覆盖的组件

Core 导出的可覆盖组件：

| 组件 | 用途 | 文件位置 |
|------|------|----------|
| `BaseLayout` | 页面基础布局 | `theme/layouts/BaseLayout.tsx` |
| `PostCard` | 帖子卡片 | `theme/components/PostCard.tsx` |
| `PostList` | 帖子列表 | `theme/components/PostList.tsx` |
| `PostDetail` | 帖子详情 | `theme/components/PostDetail.tsx` |
| `Header` | 页面头部 | `theme/components/Header.tsx` |
| `Footer` | 页面底部 | `theme/components/Footer.tsx` |
| `Sidebar` | 侧边栏 | `theme/components/Sidebar.tsx` |
| `Pagination` | 分页 | `theme/components/Pagination.tsx` |
| ... | ... | ... |

### 6.3 覆盖方式

#### 方式 A：配置注入

用户在 `createApp()` 中显式指定要覆盖的组件：

```typescript
// src/index.ts
import { createApp } from "@jant/core";
import { MyPostCard } from "./theme/components/PostCard";

export default createApp({
  theme: {
    components: {
      PostCard: MyPostCard,   // 覆盖帖子卡片
      // 未指定的组件使用 Core 默认实现
    },
  },
});
```

#### 方式 B：Swizzle CLI（推荐）

参考 [Docusaurus Swizzling](https://docusaurus.io/docs/swizzling)，提供 CLI 工具：

```bash
# 包装模式 - 扩展组件，保留原功能
pnpm jant swizzle PostCard --wrap

# 弹出模式 - 完全复制组件，自由修改
pnpm jant swizzle PostCard --eject
```

**Wrap 模式生成的代码：**

```typescript
// src/theme/components/PostCard.tsx
import type { PostCardProps } from "@jant/core";
import { PostCard as OriginalPostCard } from "@jant/core/theme";

export function PostCard(props: PostCardProps) {
  // 在原组件基础上扩展
  return (
    <div class="my-wrapper">
      <OriginalPostCard {...props} />
      <div class="my-extra">Custom content</div>
    </div>
  );
}
```

**Eject 模式：** 完整复制组件代码到用户项目，用户可完全修改。

#### 自动发现机制

Core 在渲染时按以下顺序查找组件：
1. `createApp()` 配置中指定的组件
2. `src/theme/components/` 目录下的同名组件（swizzle 生成）
3. Core 默认组件

### 6.4 组件接口

所有可覆盖组件必须遵循 Core 定义的 Props 接口：

```typescript
// @jant/core 导出的类型
export interface PostCardProps {
  post: Post;
  showExcerpt?: boolean;
  showDate?: boolean;
}

// 用户实现
// src/theme/components/PostCard.tsx
import type { PostCardProps } from "@jant/core";

export function PostCard({ post, showExcerpt, showDate }: PostCardProps) {
  return (
    <article class="my-custom-card">
      {/* 自定义实现 */}
    </article>
  );
}
```

### 6.5 第三方主题

#### 主题作者发布

```typescript
// @jant-themes/minimal/index.ts
import type { JantTheme } from "@jant/core";

export const theme: JantTheme = {
  name: "minimal",
  components: {
    PostCard: () => import("./components/PostCard"),
    PostList: () => import("./components/PostList"),
    Footer: () => import("./components/Footer"),
  },
  // 可选：CSS 变量覆盖
  cssVariables: {
    "--color-primary": "#3b82f6",
    "--color-background": "#fafafa",
  },
};

// 单独导出组件，方便用户混搭
export { PostCard } from "./components/PostCard";
export { PostList } from "./components/PostList";
export { Footer } from "./components/Footer";
```

#### 用户安装主题

```bash
pnpm add @jant-themes/minimal
```

```typescript
// src/index.ts
import { createApp } from "@jant/core";
import { theme as MinimalTheme } from "@jant-themes/minimal";

export default createApp({
  theme: MinimalTheme,
});
```

#### 混搭主题

```typescript
import { createApp } from "@jant/core";
import { theme as MinimalTheme } from "@jant-themes/minimal";
import { Footer } from "@jant-themes/fancy";
import { PostCard } from "./theme/components/PostCard"; // swizzle 生成

export default createApp({
  theme: {
    ...MinimalTheme,
    components: {
      ...MinimalTheme.components,
      Footer,      // 用 fancy 主题的 Footer
      PostCard,    // 用自己 swizzle 的 PostCard
    },
  },
});
```

### 6.6 样式覆盖

**CSS 变量覆盖：**

```css
/* src/theme/styles/custom.css */
:root {
  --color-primary: #ff6b6b;
  --color-background: #1a1a2e;
  /* 覆盖 core 的 CSS 变量 */
}
```

**Tailwind 扩展：**

用户可以在自己的项目中扩展 Tailwind 配置。

---

## 七、Core 包 API 设计

### 7.1 主导出

```typescript
// @jant/core

// 主函数
export function createApp(config: JantConfig): HonoApp;

// 类型
export type { JantConfig, Post, Media, Collection, Settings, ... };

// 工具函数（可选使用）
export { formatDate, renderMarkdown, encodeSqid, decodeSqid, ... };

// 默认组件（供覆盖时参考或组合）
export { PostCard, PostList, BaseLayout, ... };
```

### 7.2 配置接口

```typescript
interface JantConfig {
  // 站点基本信息
  site?: {
    name?: string;
    description?: string;
    language?: string;
    url?: string;
  };

  // 主题配置
  theme?: {
    // 组件覆盖
    components?: {
      BaseLayout?: ComponentType<BaseLayoutProps>;
      PostCard?: ComponentType<PostCardProps>;
      PostList?: ComponentType<PostListProps>;
      // ...
    };
    // 样式覆盖
    styles?: {
      custom?: string;  // 额外 CSS 文件路径
    };
  };

  // 功能开关
  features?: {
    search?: boolean;      // 默认 true
    rss?: boolean;         // 默认 true
    sitemap?: boolean;     // 默认 true
    i18n?: boolean;        // 默认 true
  };

  // 高级配置
  advanced?: {
    // 自定义路由
    routes?: (app: HonoApp) => void;
    // 自定义中间件
    middleware?: MiddlewareHandler[];
  };
}
```

---

## 八、版本兼容性

### 8.1 语义化版本

- **Major (x.0.0)** - 破坏性变更，需要用户修改代码
- **Minor (0.x.0)** - 新功能，向后兼容
- **Patch (0.0.x)** - Bug 修复，向后兼容

### 8.2 迁移兼容性

- 迁移文件一旦发布，永不修改
- 新的数据库变更只能通过新的迁移文件
- Core 保证迁移的向后兼容

### 8.3 组件接口兼容性

- Props 接口只能新增可选属性
- 不能删除或修改必填属性的类型
- 废弃的属性标记 `@deprecated`，至少保留一个 major 版本

---

## 九、开发工作流

### 9.1 Core 开发

```bash
# 在 packages/core 开发
cd packages/core
pnpm dev

# 运行测试
pnpm test

# 构建发布
pnpm build
pnpm publish
```

### 9.2 Template 测试

```bash
# 在 templates/jant-site 测试
cd templates/jant-site
pnpm install
pnpm dev

# 这里可以测试最新的 core 代码
```

### 9.3 本地链接开发

```bash
# 在 core 目录
cd packages/core
pnpm link --global

# 在 template 目录
cd templates/jant-site
pnpm link @jant/core

# 现在 template 使用本地的 core
```

---

## 十、未来扩展

### 10.1 多模板支持

```
templates/
├── cloudflare/      # Cloudflare Workers
├── node/            # Node.js (Express/Fastify)
├── deno/            # Deno Deploy
└── bun/             # Bun
```

### 10.2 插件系统

```typescript
createApp({
  plugins: [
    analyticsPlugin(),
    commentsPlugin(),
    newsletterPlugin(),
  ],
});
```

### 10.3 主题市场

- 社区贡献的完整主题包
- 一键安装和切换
- 主题继承和组合
