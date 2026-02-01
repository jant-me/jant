import type { LinguiConfig } from "@lingui/conf";

const config: LinguiConfig = {
  locales: ["en", "zh-Hans", "zh-Hant"],
  sourceLocale: "en",
  catalogs: [
    {
      path: "<rootDir>/src/i18n/locales/{locale}",
      include: ["<rootDir>/src/**/*.{ts,tsx}"],
    },
  ],
  format: "po",
  compileNamespace: "ts",
};

export default config;
