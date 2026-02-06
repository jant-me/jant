# i18n Usage Examples

## New API: useLingui() Hook

We now use a React-like hook API that eliminates prop drilling and makes code cleaner.

### Basic Pattern

```tsx
import { I18nProvider, useLingui } from "@/i18n";

// 1. Wrap your app in route handler
dashRoute.get("/", async (c) => {
  return c.html(
    <I18nProvider c={c}>
      <MyApp />
    </I18nProvider>,
  );
});

// 2. Use useLingui() hook inside components
function MyApp() {
  const { t } = useLingui();

  return (
    <h1>{t({ message: "Dashboard", comment: "@context: Page title" })}</h1>
  );
}
```

### Why the `comment` field?

The `comment` field provides context for AI translators, improving translation quality:

```tsx
// ✅ Good - clear context
t({ message: "Dashboard", comment: "@context: Page title" });
t({ message: "Dashboard", comment: "@context: Navigation link" });

// ❌ Bad - no context (translator might choose wrong word)
t({ message: "Dashboard" });
```

---

## Complete Example

```tsx
import { I18nProvider, useLingui, Trans } from "@/i18n";

// Route handler: wrap in I18nProvider
dashRoute.get("/", async (c) => {
  const posts = await c.var.services.posts.list();

  return c.html(
    <I18nProvider c={c}>
      <Dashboard postCount={posts.length} username="Alice" />
    </I18nProvider>,
  );
});

// Component: use useLingui() hook
function Dashboard({
  postCount,
  username,
}: {
  postCount: number;
  username: string;
}) {
  const { t } = useLingui();

  return (
    <div>
      {/* 1. Simple translation */}
      <h1>{t({ message: "Dashboard", comment: "@context: Page title" })}</h1>

      {/* 2. With variables */}
      <p>
        {t(
          {
            message: "Welcome back, {name}!",
            comment: "@context: Welcome message",
          },
          { name: username },
        )}
      </p>

      {/* 3. With dynamic values */}
      <p>
        {t(
          {
            message: "You have {count} posts",
            comment: "@context: Post count",
          },
          { count: postCount },
        )}
      </p>

      {/* 4. With embedded components */}
      <p>
        <Trans comment="@context: Help text">
          Read the{" "}
          <a href="/docs" class="underline">
            documentation
          </a>{" "}
          for help
        </Trans>
      </p>
    </div>
  );
}
```

---

## Trans Component: Embedded JSX

The `Trans` component is a simplified implementation that renders children as-is. It's useful for translations with embedded links or formatting.

```tsx
import { Trans } from "@/i18n";

// Simple link
<Trans comment="@context: Website link">
  Visit <a href="/" class="text-primary">our website</a>
</Trans>

// Multiple elements
<Trans comment="@context: Learn more link">
  Click <strong class="font-bold">here</strong> to <a href="/learn" class="underline">learn more</a>
</Trans>

// With formatting
<Trans comment="@context: Welcome message">
  Welcome <strong class="font-semibold">back</strong>!
</Trans>
```

**Note**: This is a simplified implementation that renders children directly. For complex translations with dynamic placeholders, use the `t()` function instead:

```tsx
const { t } = useLingui();

// For dynamic content, use t() with placeholders
<p>
  {t(
    {
      message: "Visit {linkStart}our website{linkEnd}",
      comment: "@context: Website link",
    },
    {
      linkStart: '<a href="/" class="text-primary">',
      linkEnd: "</a>",
    },
  )}
</p>;
```

---

## Comparison: Before vs Now

### Before (Prop drilling required)

```tsx
import { getI18n } from "@/i18n";

dashRoute.get("/", async (c) => {
  const i18n = getI18n(c);

  return c.html(
    <Layout>
      <MyComponent c={c} /> {/* Must pass c prop */}
    </Layout>,
  );
});

function MyComponent({ c }: { c: Context }) {
  const i18n = getI18n(c);
  const title = i18n._({ message: "Dashboard", comment: "@context: Title" });
  const greeting = i18n._(
    { message: "Hello {name}", comment: "@context: Greeting" },
    { name: "Alice" },
  );

  return <h1>{title}</h1>;
}
```

### Now (No prop drilling)

```tsx
import { I18nProvider, useLingui } from "@/i18n";

dashRoute.get("/", async (c) => {
  return c.html(
    <I18nProvider c={c}>
      <Layout>
        <MyComponent /> {/* No props needed */}
      </Layout>
    </I18nProvider>,
  );
});

function MyComponent() {
  const { t } = useLingui();
  const title = t({ message: "Dashboard", comment: "@context: Title" });
  const greeting = t(
    { message: "Hello {name}", comment: "@context: Greeting" },
    { name: "Alice" },
  );

  return <h1>{title}</h1>;
}
```

---

## Best Practices

1. **Always wrap in I18nProvider**: Wrap your app in `<I18nProvider c={c}>` in route handlers
2. **Use useLingui() hook**: Call `const { t } = useLingui()` inside components
3. **Always include comment**: Provide `@context:` comment for better AI translations
4. **Variables as second param**: `t({ message: "Hello {name}", comment: "..." }, { name })`
5. **Use Trans for embedded JSX**: Use `<Trans>` for links and formatting
6. **Extract translations**: Run `pnpm i18n:extract` after adding new strings
7. **Compile translations**: Run `pnpm i18n:compile` to generate catalog files

---

## Common Questions

### Q: Why can't I use `t("Dashboard")` directly?

A: Lingui uses a build-time extraction process. The `t()` function expects a message descriptor object that gets transformed by Lingui's macro system during the build. If you pass a plain string, the extraction tool won't be able to find and extract the message for translation.

You must use the object syntax:

```tsx
t({ message: "Dashboard", comment: "@context: Page title" });
```

### Q: Can I use Lingui's official Trans component?

A: Lingui's `Trans` component is designed for React and requires React Context. Since we use Hono JSX (not React), we provide a simplified `Trans` component that works with our SSR setup. It renders children directly without complex transformation.

### Q: Why use useLingui() instead of getI18n(c)?

A: The `useLingui()` hook provides a cleaner API that eliminates prop drilling. Instead of passing the Hono context `c` to every component, you wrap your app once in `I18nProvider` and all child components can access i18n via the hook.

### Q: Is this safe for concurrent requests?

A: Yes! Each request creates its own i18n instance via `I18nProvider`. The global state is only used during the synchronous rendering phase, so there's no risk of race conditions between concurrent requests.

### Q: What if I call useLingui() outside I18nProvider?

A: You'll get an error: "useLingui() called outside of I18nProvider". This is intentional - the hook must be used within the provider context. Always wrap your app in `<I18nProvider c={c}>` in your route handlers.
