import { formatter } from "@lingui/format-po";
import type { LinguiConfig } from "@lingui/conf";

const config: LinguiConfig = {
  locales: ["en", "zh-Hans", "zh-Hant"],
  sourceLocale: "en",
  catalogs: [
    {
      // Settings/admin surface, plus `/subscribe` — this catalog is translated.
      //
      // Admin membership must match `ADMIN_PATH_PREFIXES` in `i18n/middleware.ts`:
      // that list decides which routes render in the author's language at all,
      // and this list decides which strings have one. `/setup` is on it, so
      // setup lives here even though it is not under `dash/` — its strings
      // would otherwise be translated in the .po and English on screen.
      //
      // `/subscribe` is the one reader page with prose paragraphs explaining
      // feeds and readers. It resolves its own page-scoped `createI18n` from
      // the view/site language while leaving public chrome on `baseLocale`.
      path: "<rootDir>/src/i18n/locales/settings/{locale}",
      include: [
        "<rootDir>/src/routes/dash/**/*.{ts,tsx}",
        "<rootDir>/src/ui/dash/**/*.{ts,tsx}",
        "<rootDir>/src/routes/auth/setup.tsx",
        "<rootDir>/src/routes/pages/subscribe.tsx",
        "<rootDir>/src/ui/pages/SubscribePage.tsx",
      ],
    },
    {
      // Public/reader surface — only `en` is maintained. No zh-Hans .po is
      // generated (see mise `i18n-translate-zh-Hans`), so Lingui falls back
      // to the source English message at runtime under zh-Hans.
      path: "<rootDir>/src/i18n/locales/public/{locale}",
      include: ["<rootDir>/src/**/*.{ts,tsx}"],
      exclude: [
        "<rootDir>/src/routes/dash/**",
        "<rootDir>/src/ui/dash/**",
        "<rootDir>/src/routes/auth/setup.tsx",
        "<rootDir>/src/routes/pages/subscribe.tsx",
        "<rootDir>/src/ui/pages/SubscribePage.tsx",
      ],
    },
  ],
  format: formatter({ origins: true, lineNumbers: false }),
  compileNamespace: "ts",
};

export default config;
