# Jant i18n - React-like API for Hono JSX

## ✅ API Overview

We provide a React-like i18n API that works with Hono JSX SSR!

### 1. **I18nProvider** - Like React Context Provider

```tsx
import { I18nProvider } from "@/i18n";

// Wrap your app in route handler
dashRoute.get("/", async (c) => {
  return c.html(
    <I18nProvider c={c}>
      <YourApp />
    </I18nProvider>
  );
});
```

### 2. **useLingui()** - Like React hook

```tsx
import { useLingui } from "@/i18n";

function MyComponent() {
  // React-like hook API
  const { t } = useLingui();

  return (
    <div>
      {/* Simple and clean */}
      <h1>{t({ message: "Dashboard", comment: "@context: Page title" })}</h1>
    </div>
  );
}
```

### 3. **Trans Component** - For Embedded JSX

```tsx
import { Trans } from "@/i18n";

function MyComponent() {
  return (
    <Trans comment="@context: Help text">
      Read the <a href="/docs">documentation</a>
    </Trans>
  );
}
```

---

## 📝 Complete Example

```tsx
/**
 * Dashboard Route - React-like i18n API
 */

import { Hono } from "hono";
import { I18nProvider, useLingui, Trans } from "@/i18n";

export const dashRoute = new Hono();

// Component: use useLingui() hook
function DashboardContent({ postCount }: { postCount: number }) {
  const { t } = useLingui();

  return (
    <div>
      {/* 1. Simple translation */}
      <h1>{t({ message: "Dashboard", comment: "@context: Page title" })}</h1>

      {/* 2. With variables */}
      <p>
        {t(
          { message: "You have {count} posts", comment: "@context: Post count message" },
          { count: postCount }
        )}
      </p>

      {/* 3. With embedded components - use Trans */}
      <p>
        <Trans comment="@context: Help text">
          Read the <a href="/docs" class="underline">documentation</a>
        </Trans>
      </p>
    </div>
  );
}

// Route handler: wrap in I18nProvider
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

## 🆚 Comparison: Before vs Now

### Before (Complex - prop drilling)

```tsx
import { getI18n } from "@/i18n";

dashRoute.get("/", async (c) => {
  const i18n = getI18n(c);

  return c.html(
    <Layout title={i18n._({ message: "Dashboard", comment: "@context: ..." })}>
      <MyComponent c={c} />  {/* Need to pass c prop */}
    </Layout>
  );
});

function MyComponent({ c }: { c: Context }) {
  const i18n = getI18n(c);
  return <h1>{i18n._({ message: "Hello", comment: "@context: ..." })}</h1>;
}
```

### Now (Clean - no prop drilling)

```tsx
import { I18nProvider, useLingui } from "@/i18n";

dashRoute.get("/", async (c) => {
  return c.html(
    <I18nProvider c={c}>
      <Layout>
        <MyComponent />  {/* No need to pass c prop */}
      </Layout>
    </I18nProvider>
  );
});

function MyComponent() {
  const { t } = useLingui();  // Like React hook
  return <h1>{t({ message: "Hello", comment: "@context: ..." })}</h1>;
}
```

---

## ⚠️ Important Notes

### 1. **Always include `comment` field**

```tsx
// ✅ Correct - comment is crucial for AI translation
const { t } = useLingui();
t({ message: "Dashboard", comment: "@context: Page title" })

// ❌ Wrong - missing comment reduces translation quality
t({ message: "Dashboard" })
```

### 2. **I18nProvider must wrap your app**

```tsx
// ✅ Correct - wrap in I18nProvider
c.html(
  <I18nProvider c={c}>
    <App />
  </I18nProvider>
)

// ❌ Wrong - useLingui() will throw error
c.html(<App />)  // useLingui() inside App won't find i18n context
```

### 3. **useLingui() only works inside components**

```tsx
// ✅ Correct - inside JSX component
function MyComponent() {
  const { t } = useLingui();
  return <div>{t({ message: "Hello", comment: "@context: ..." })}</div>;
}

// ❌ Wrong - in route handler (outside I18nProvider)
dashRoute.get("/", async (c) => {
  const { t } = useLingui();  // Error: not inside I18nProvider
  ...
});
```

### 4. **Variables go in second parameter**

```tsx
const { t } = useLingui();

// ✅ Correct - values as second parameter
t({ message: "Hello {name}", comment: "@context: Greeting" }, { name: "Alice" })

// ❌ Wrong - values inside first parameter (not supported)
t({ message: "Hello {name}", comment: "@context: Greeting", values: { name: "Alice" } })
```

---

## 🎯 Best Practices

1. **Route handler**: Wrap app in `<I18nProvider c={c}>`
2. **Inside components**: Use `useLingui()` hook to get `t()` function
3. **Translation calls**: `t({ message: "...", comment: "@context: ..." })`
4. **With embedded JSX**: Use `<Trans>` component
5. **Always include `comment`**: Helps AI understand context for better translations

---

## 📚 API Reference

### `I18nProvider`

Provides i18n context to all child components. Must wrap your app in route handlers.

```tsx
interface I18nProviderProps {
  c: Context;  // Hono context
  children: JSX.Element;
}

// Usage
<I18nProvider c={c}>
  <YourApp />
</I18nProvider>
```

### `useLingui()`

Hook to access i18n functionality inside components. Must be used within `I18nProvider`.

```tsx
function useLingui(): {
  i18n: I18n;  // Lingui i18n instance
  t: (descriptor: MessageDescriptor, values?: Record<string, any>) => string;
  _: (descriptor: MessageDescriptor, values?: Record<string, any>) => string;
}

// Usage
function MyComponent() {
  const { t } = useLingui();
  return <h1>{t({ message: "Hello", comment: "@context: Greeting" })}</h1>;
}
```

**Note**: `t()` and `_()` are equivalent - use whichever you prefer.

### `Trans`

Component for translations with embedded JSX elements. Simplified implementation that renders children as-is.

```tsx
interface TransProps {
  comment?: string;  // @context comment for translators
  id?: string;       // Optional message ID
  children: JSX.Element;  // JSX content with embedded elements
}

// Usage
<Trans comment="@context: Help text">
  Read the <a href="/docs">documentation</a>
</Trans>
```

**Note**: This is a simplified implementation. For complex translations with dynamic content, use `t()` with placeholders instead.

---

## 🔧 How It Works

1. **I18nProvider** sets the global i18n instance during rendering
2. **useLingui()** reads the current i18n instance from global state
3. **Single-pass rendering**: Each request renders only once, making global state safe
4. **Concurrency-safe**: Each request creates a new i18n instance, preventing race conditions

This implementation mimics React's Context API but is optimized for Hono JSX SSR scenarios.

### Why Global State is Safe

Unlike React (client-side with multiple re-renders), Hono JSX renders once per request on the server:
- Request arrives → I18nProvider sets global i18n → Components render → Response sent
- Next request → New i18n instance → Components render → Response sent

Since rendering is synchronous and single-pass, there's no risk of concurrent requests interfering with each other.
