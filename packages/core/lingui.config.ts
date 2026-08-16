import { formatter } from "@lingui/format-po";
import type { LinguiConfig } from "@lingui/conf";

const config: LinguiConfig = {
  locales: ["en", "zh-Hans", "zh-Hant"],
  sourceLocale: "en",
  catalogs: [
    {
      // Settings/admin surface — this catalog is translated.
      //
      // Membership must match `ADMIN_PATH_PREFIXES` in `i18n/middleware.ts`:
      // that list decides which routes render in the author's language at all,
      // and this list decides which strings have one. `/setup` is on it, so
      // setup lives here even though it is not under `dash/` — its strings
      // would otherwise be translated in the .po and English on screen.
      path: "<rootDir>/src/i18n/locales/settings/{locale}",
      include: [
        "<rootDir>/src/routes/dash/**/*.{ts,tsx}",
        "<rootDir>/src/ui/dash/**/*.{ts,tsx}",
        "<rootDir>/src/routes/auth/setup.tsx",
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
      ],
    },
  ],
  format: formatter({ origins: true, lineNumbers: false }),
  compileNamespace: "ts",
};

export default config;
