import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import swc from "unplugin-swc";
import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";

export default defineConfig({
  publicDir: false,
  server: {
    port: 9019,
    host: true,
    allowedHosts: true,
  },
  preview: {
    port: 9019,
  },
  plugins: [
    swc.vite({
      jsc: {
        parser: {
          syntax: "typescript",
          tsx: true,
        },
        transform: {
          react: {
            runtime: "automatic",
            importSource: "hono/jsx",
          },
        },
        target: "es2022",
        experimental: {
          plugins: [
            [
              "@lingui/swc-plugin",
              {
                runtimeConfigModule: {
                  useLingui: ["@jant/core/src/i18n/index.ts", "useLingui"],
                  Trans: ["@jant/core/src/i18n/index.ts", "Trans"],
                },
              },
            ],
          ],
        },
      },
      module: {
        type: "es6",
      },
    }),
    cloudflare({
      configPath: "./wrangler.toml",
      // Override config for specific environments (e.g., WRANGLER_ENV=demo)
      config: (config) => {
        const env = process.env.WRANGLER_ENV;
        if (!env) return;

        // Read environment-specific config from wrangler.toml
        // The cloudflare plugin doesn't natively support wrangler environments,
        // so we manually apply the env config here
        const envConfig = config.env?.[env];
        if (!envConfig) return;

        // Apply environment overrides
        if (envConfig.name) config.name = envConfig.name;
        if (envConfig.vars) config.vars = { ...config.vars, ...envConfig.vars };
        if (envConfig.d1_databases) config.d1_databases = envConfig.d1_databases;
        if (envConfig.r2_buckets) config.r2_buckets = envConfig.r2_buckets;
      },
    }),
  ],
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
  build: {
    target: "esnext",
    minify: false,
    manifest: true,
    rollupOptions: {
      input: {
        styles: "@jant/core/src/theme/styles/main.css",
        client: "@jant/core/src/client.ts",
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
      external: ["cloudflare:*", "__STATIC_CONTENT_MANIFEST"],
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
