# Jant i18n - React-like API for Hono JSX

## ✅ 完成的改进

我们现在有了类似 React 的 i18n API！

### 1. **I18nProvider** - 类似 React Context Provider

```tsx
import { I18nProvider } from "@/i18n";

// 在 route handler 中包裹你的 app
dashRoute.get("/", async (c) => {
  return c.html(
    <I18nProvider c={c}>
      <YourApp />
    </I18nProvider>
  );
});
```

### 2. **useLingui()** - 类似 React hook

```tsx
import { t } from "@lingui/core/macro";
import { useLingui } from "@/i18n";

function MyComponent() {
  // 🎉 类似 React 的 hook API！
  const { _, i18n } = useLingui();

  return (
    <div>
      {/* ✅ 简洁：_(t({ ... })) */}
      <h1>{_(t({ message: "Dashboard", comment: "@context: Page title" }))}</h1>
    </div>
  );
}
```

### 3. **使用 `t` macro，不是 `msg`**

```tsx
import { t } from "@lingui/core/macro";  // ✅ 使用 t
// import { msg } from "@lingui/core/macro";  // ❌ 不要用 msg

const { _ } = useLingui();

// ✅ 正确
_(t({ message: "Hello", comment: "@context: Greeting" }))

// ❌ 旧的方式（仍然支持，但不推荐）
const tFunc = useT(c);
tFunc(msg({ message: "Hello", comment: "@context: Greeting" }))
```

---

## 📝 完整示例

```tsx
/**
 * Dashboard Route - React-like i18n API
 */

import { Hono } from "hono";
import { t } from "@lingui/core/macro";
import { I18nProvider, useLingui, Trans } from "@/i18n";

export const dashRoute = new Hono();

// 组件：使用 useLingui() hook
function DashboardContent({ postCount }: { postCount: number }) {
  const { _ } = useLingui();

  return (
    <div>
      {/* 1. 简单翻译 */}
      <h1>{_(t({ message: "Dashboard", comment: "@context: Page title" }))}</h1>

      {/* 2. 带变量 */}
      <p>
        {_(
          t({ message: `You have ${postCount} posts`, comment: "@context: Post count message" })
        )}
      </p>

      {/* 3. 带组件 - 使用 Trans */}
      <p>
        <Trans message={t({ message: "Read the <link>documentation</link>", comment: "@context: Help text" })}>
          <a href="/docs" class="underline" />
        </Trans>
      </p>
    </div>
  );
}

// Route handler：包裹在 I18nProvider 中
dashRoute.get("/", async (c) => {
  const posts = await c.var.services.posts.list();

  return c.html(
    <I18nProvider c={c}>
      <DashboardContent postCount={posts.length} />
    </I18nProvider>
  );
});
```

---

## 🆚 对比：之前 vs 现在

### 之前（复杂）

```tsx
import { msg } from "@lingui/core/macro";
import { useT } from "@/i18n";

dashRoute.get("/", async (c) => {
  const t = useT(c);  // 需要传 c

  return c.html(
    <Layout title={t(msg({ message: "Dashboard", comment: "@context: ..." }))}>
      <MyComponent c={c} t={t} />  {/* 需要 prop drilling */}
    </Layout>
  );
});

function MyComponent({ c, t }: { c: Context; t: Function }) {
  return <h1>{t(msg({ message: "Hello", comment: "@context: ..." }))}</h1>;
}
```

### 现在（简洁）

```tsx
import { t } from "@lingui/core/macro";
import { I18nProvider, useLingui } from "@/i18n";

dashRoute.get("/", async (c) => {
  return c.html(
    <I18nProvider c={c}>
      <Layout>
        <MyComponent />  {/* 不需要传 c 或 t */}
      </Layout>
    </I18nProvider>
  );
});

function MyComponent() {
  const { _ } = useLingui();  // 🎉 就像 React hook！
  return <h1>{_(t({ message: "Hello", comment: "@context: ..." }))}</h1>;
}
```

---

## ⚠️ 重要注意事项

### 1. **必须保留 `comment`**

```tsx
// ✅ 正确 - comment 对 AI 翻译非常重要
_(t({ message: "Dashboard", comment: "@context: Page title" }))

// ❌ 错误 - 缺少 comment
_(t`Dashboard`)  // 虽然语法支持，但缺少 context，翻译质量会下降
```

### 2. **I18nProvider 必须在最外层**

```tsx
// ✅ 正确
c.html(
  <I18nProvider c={c}>
    <App />
  </I18nProvider>
)

// ❌ 错误 - useLingui() 会报错
c.html(<App />)  // App 内部的 useLingui() 找不到 context
```

### 3. **useLingui() 只能在组件中使用**

```tsx
// ✅ 正确 - 在 JSX 组件中
function MyComponent() {
  const { _ } = useLingui();
  return <div>{_(t({ ... }))}</div>;
}

// ❌ 错误 - 在 route handler 中
dashRoute.get("/", async (c) => {
  const { _ } = useLingui();  // ❌ 不在 I18nProvider 内部
  ...
});
```

---

## 🎯 最佳实践

1. **Route handler**：使用 `<I18nProvider c={c}>` 包裹
2. **组件内部**：使用 `useLingui()` hook
3. **翻译调用**：`_(t({ message: "...", comment: "@context: ..." }))`
4. **带组件**：使用 `<Trans>` 组件
5. **总是包含 `comment`**：帮助 AI 理解上下文，提高翻译质量

---

## 📚 API 参考

### `I18nProvider`

```tsx
interface I18nProviderProps {
  c: Context;  // Hono context
  children: JSX.Element;
}
```

### `useLingui()`

```tsx
function useLingui(): {
  i18n: I18n;           // Lingui i18n instance
  _: (descriptor: MessageDescriptor, values?: Record<string, any>) => string;
}
```

### `Trans`

```tsx
interface TransProps {
  message: MessageDescriptor;  // 来自 t({ ... })
  children?: JSX.Element | JSX.Element[];  // 组件（按顺序映射到 message 中的标签）
  values?: Record<string, any>;  // 变量
}
```

---

## 🔧 工作原理

1. **I18nProvider** 设置全局的 i18n 实例（在渲染期间）
2. **useLingui()** 从全局状态读取当前的 i18n 实例
3. **单次渲染**：每个请求只渲染一次，所以全局状态是安全的
4. **并发安全**：每个请求创建新的 i18n 实例，不会互相干扰

这个方案模仿了 React 的 Context API，但是为 Hono JSX 的 SSR 场景优化。
