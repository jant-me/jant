import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  define: {
    __JANT_DEV__: "false",
    __JANT_VERSION__: JSON.stringify("test-version"),
    __CLIENT_JS_FILE__: JSON.stringify("/_assets/client.js"),
    __CLIENT_AUTH_JS_FILE__: JSON.stringify("/_assets/client-auth.js"),
    __CLIENT_COMPOSE_PRELOAD__: JSON.stringify([]),
    __CLIENT_CSS_FILE__: JSON.stringify("/_assets/client.css"),
    __CLIENT_CJK_CSS_FILE__: JSON.stringify("/_assets/client-cjk.css"),
    __CLIENT_CJK_TC_CSS_FILE__: JSON.stringify("/_assets/client-cjk-tc.css"),
    __CLIENT_CJK_JP_CSS_FILE__: JSON.stringify("/_assets/client-cjk-jp.css"),
    __CLIENT_CJK_KR_CSS_FILE__: JSON.stringify("/_assets/client-cjk-kr.css"),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@lingui/core/macro": resolve(
        __dirname,
        "src/__tests__/helpers/lingui-core-macro-mock.ts",
      ),
    },
  },
  test: {
    globals: true,
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/**/__tests__/**/*.test.tsx",
    ],
  },
});
