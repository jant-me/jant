# i18n Usage Examples

## 为什么必须用 `msg()`？

**简短回答**：`msg()` 不是普通函数，是**编译时宏**（macro）。

**工作原理**：
```tsx
// 1. 你写的代码
t(msg`Dashboard`)

// 2. 编译时 SWC 插件转换成
t({ id: "7p5kLi" })

// 3. 运行时查找翻译
i18n._({ id: "7p5kLi" }) // → "仪表板"
```

如果不用 `msg()`，Lingui 编译器就无法提取消息，也就无法生成翻译文件。

**好消息**：可以用更简洁的语法！

---

## 简化语法：使用 template literal

```tsx
import { msg } from "@lingui/core/macro";
import { useT } from "@/i18n";

const t = useT(c);

// ✅ 最简洁（适合不需要 context 的情况）
const title = t(msg`Dashboard`);

// ✅ 带 context（推荐，帮助翻译者理解）
const title = t(msg({ message: "Dashboard", comment: "@context: Page title" }));

// ✅ 带变量
const greeting = t(msg`Hello ${name}`); // 自动处理变量

// ✅ 带变量 + context
const greeting = t(
  msg({ message: `Hello ${name}`, comment: "@context: Greeting" })
);
```

---

## 完整示例：简化版

```tsx
import { msg } from "@lingui/core/macro";
import { useT, Trans } from "@/i18n";

dashRoute.get("/", async (c) => {
  const t = useT(c);
  const username = "Alice";
  const postCount = 42;

  return c.html(
    <div>
      {/* 1. 最简单的翻译 */}
      <h1>{t(msg`Dashboard`)}</h1>

      {/* 2. 带变量 */}
      <p>{t(msg`Welcome back, ${username}!`)}</p>

      {/* 3. 带变量 + context（推荐） */}
      <p>
        {t(
          msg({ message: `You have ${postCount} posts`, comment: "@context: Post count" })
        )}
      </p>

      {/* 4. 带组件 */}
      <p>
        <Trans
          c={c}
          message={msg`Read the <link>documentation</link> for help`}
          components={{
            link: <a href="/docs" class="underline" />
          }}
        />
      </p>
    </div>
  );
});
```

---

## Trans 组件：嵌入 JSX 组件

```tsx
import { msg } from "@lingui/core/macro";
import { Trans } from "@/i18n";

// 简单链接
<Trans
  c={c}
  message={msg`Visit <link>our website</link>`}
  components={{
    link: <a href="/" class="text-primary" />
  }}
/>

// 多个组件
<Trans
  c={c}
  message={msg`Click <bold>here</bold> to <link>learn more</link>`}
  components={{
    bold: <strong class="font-bold" />,
    link: <a href="/learn" class="underline" />
  }}
/>

// 带变量
<Trans
  c={c}
  message={msg`Welcome <bold>${username}</bold>!`}
  components={{
    bold: <strong class="font-semibold" />
  }}
/>
```

---

## 对比：之前 vs 现在

```tsx
// ❌ 之前（太繁琐）
const i18n = getI18n(c);
const title = i18n._(msg({ message: "Dashboard", comment: "@context: Title" }));
const greeting = i18n._(msg({ message: `Hello ${name}`, comment: "@context: Greeting" })) as any;

// ✅ 现在（简洁）
const t = useT(c);
const title = t(msg`Dashboard`);
const greeting = t(msg`Hello ${name}`);

// ✅ 如果需要 context（帮助翻译）
const title = t(msg({ message: "Dashboard", comment: "@context: Page title" }));
```

---

## 推荐实践

1. **简单文本**：用 ``msg`text` ``
2. **需要 context**：用 `msg({ message: "text", comment: "@context: ..." })`
3. **嵌入组件**：用 `<Trans>` 组件
4. **提取翻译**：`pnpm i18n:extract`
5. **编译翻译**：`pnpm i18n:compile`

---

## 常见问题

### Q: 为什么不能 `t("Dashboard")` 直接传字符串？

A: 因为 Lingui 需要在**编译时**提取消息。`msg()` 是编译时宏，会被 SWC 插件在编译时替换成 hash ID。如果你写 `t("Dashboard")`，编译器无法提取消息，翻译就无法工作。

### Q: 能不能直接用 Lingui 官方的 Trans 组件？

A: Lingui 的 `Trans` 组件是为 React 设计的，需要 React Context。我们用的是 Hono JSX（不是 React），所以需要自己实现。我们的 `Trans` 组件模仿了 Lingui 的 API，但适配了 Hono JSX。

### Q: `msg()` 支持哪些语法？

A: 支持：
- Template literal: `` msg`Hello` ``
- Template with variables: `` msg`Hello ${name}` ``
- Object with context: `msg({ message: "Hello", comment: "@context: Greeting" })`
- Object with variables: `msg({ message: `Hello ${name}`, comment: "@context: Greeting" })`
