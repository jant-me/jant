import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";

export default [
  // Global ignores (must be first)
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "**/*.config.js",
      "**/*.config.ts",
      "**/.lingui/**",
      "**/assets.gen.ts",
      "**/i18n/locales/**/*.ts",
      "**/src/assets/**",
      "**/bin/**",
      "references/**",
    ],
  },
  {
    files: ["packages/*/src/**/*.{ts,tsx}", "templates/*/src/**/*.{ts,tsx}"],
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
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
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLFormElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLSelectElement: "readonly",
        HTMLDialogElement: "readonly",
        HTMLVideoElement: "readonly",
        HTMLAudioElement: "readonly",
        HTMLCanvasElement: "readonly",
        CanvasRenderingContext2D: "readonly",
        HTMLAnchorElement: "readonly",
        HTMLSourceElement: "readonly",
        Audio: "readonly",
        AudioContext: "readonly",
        getComputedStyle: "readonly",
        VideoEncoder: "readonly",
        Event: "readonly",
        CustomEvent: "readonly",
        EventListener: "readonly",
        customElements: "readonly",
        navigator: "readonly",
        queueMicrotask: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        PointerEvent: "readonly",
        TouchEvent: "readonly",
        DragEvent: "readonly",
        Node: "readonly",
        DataTransfer: "readonly",
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        AbortController: "readonly",
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
        // Timers (available in Workers, Node, and browsers)
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        // Encoding (available in Workers, Node, and browsers)
        atob: "readonly",
        btoa: "readonly",
        // Cloudflare Workers specific
        crypto: "readonly",
        caches: "readonly",
        scheduler: "readonly",
        D1Database: "readonly",
        D1Result: "readonly",
        R2Bucket: "readonly",
        KVNamespace: "readonly",
        Queue: "readonly",
        MessageBatch: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
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
    files: [
      "packages/*/src/**/__tests__/**/*.{ts,tsx}",
      "packages/*/src/**/__test__/**/*.{ts,tsx}",
      "templates/*/src/**/__tests__/**/*.{ts,tsx}",
      "templates/*/src/**/__test__/**/*.{ts,tsx}",
    ],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
      "no-debugger": "off",
      "prefer-const": "off",
    },
  },
];
