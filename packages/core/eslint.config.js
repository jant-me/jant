import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        // Node.js globals
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
        // Browser/Workers globals
        window: "readonly",
        document: "readonly",
        console: "readonly",
        fetch: "readonly",
        Image: "readonly",
        HTMLImageElement: "readonly",
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        File: "readonly",
        ReadableStream: "readonly",
        WritableStream: "readonly",
        TransformStream: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        // Cloudflare Workers specific
        crypto: "readonly",
        caches: "readonly",
        scheduler: "readonly",
        D1Database: "readonly",
        D1Result: "readonly",
        R2Bucket: "readonly",
        KVNamespace: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
    },
    rules: {
      // TypeScript
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",

      // React/JSX
      "react/jsx-uses-react": "off", // Not needed with Hono JSX
      "react/react-in-jsx-scope": "off", // Not needed with Hono JSX
      "react/prop-types": "off", // Using TypeScript instead

      // General
      "no-console": "warn",
      "no-debugger": "warn",
      "no-unused-vars": "off", // Use @typescript-eslint/no-unused-vars instead
      "prefer-const": "warn",
      "no-var": "error",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".wrangler/**",
      "*.config.js",
      "*.config.ts",
      ".lingui/**",
      "src/lib/assets.gen.ts",
      "src/i18n/locales/*.ts",
      "src/assets/**", // Third-party assets like datastar.min.js
    ],
  },
];
