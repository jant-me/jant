import { randomBytes, createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { executeD1, queryD1 } from "../lib/d1-query.js";
import { openNodeDatabase } from "../lib/node-database.js";
import { loadNodeRuntime } from "../lib/load-node-runtime.js";
import {
  bootstrapCliRuntime,
  getCliRuntimeLabel,
} from "../lib/runtime-target.js";
import { parseCliSiteSelector, resolveCliSite } from "../lib/site-selection.js";

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      database: { type: "string", default: "DB" },
      env: { type: "string" },
      host: { type: "string" },
      local: { type: "boolean", default: false },
      node: { type: "boolean", default: false },
      "path-prefix": { type: "string" },
      "persist-to": { type: "string" },
      remote: { type: "boolean", default: false },
      site: { type: "string" },
      url: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(
      "Usage: jant reset-password [--local | --remote | --node] [--site <key|id> | --host <host> | --url <url>]",
    );
    console.log("");
    console.log("Generate a password reset token (expires in 15 minutes).");
    console.log("");
    console.log("Options:");
    console.log("  --local   Force local D1 instead of DATABASE_URL");
    console.log("  --remote  Run against remote D1 database (default: local)");
    console.log("  --node    Force Node runtime even if DATABASE_URL is unset");
    console.log("  --site    Target site key or id");
    console.log("  --host    Target site host");
    console.log("  --url     Target site URL");
    console.log("  --path-prefix Path prefix used with --host");
    console.log("  --config  Wrangler config file (default: wrangler.toml)");
    console.log("  --env     Wrangler environment name");
    console.log("  --database D1 binding name (default: DB)");
    console.log("  --persist-to Local D1 state directory override");
    console.log("");
    console.log(
      "`.env.node` next to your project (or in packages/core/) is auto-loaded.",
    );
    console.log(
      "If DATABASE_URL or DATA_DIR is then set and no runtime flag is passed,",
    );
    console.log("this command uses the Node database runtime.");
    console.log("");
    console.log(
      "With SITE_RESOLUTION_MODE=host-based, pass one of --site, --host, or --url.",
    );
    process.exit(0);
  }

  const { runtime } = bootstrapCliRuntime(values);
  const siteFlags = {
    host: values.host,
    pathPrefix: values["path-prefix"],
    site: values.site,
    url: values.url,
  };

  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const expiry = Math.floor(Date.now() / 1000) + 15 * 60;
  const value = `${hash}:${expiry}`;
  const timestamp = Math.floor(Date.now() / 1000);

  if (runtime === "node") {
    const siteSelector = parseCliSiteSelector(siteFlags);
    const { createNodeCliRuntime } = await loadNodeRuntime();
    const nodeDatabase = await openNodeDatabase(process.env);

    try {
      const nodeRuntime = await createNodeCliRuntime(
        nodeDatabase.bindings,
        siteSelector,
      );
      await nodeRuntime.services.settings.set("PASSWORD_RESET_TOKEN", value);
    } finally {
      await nodeDatabase.close();
    }
  } else {
    const d1Options = {
      configPath: values.config,
      database: values.database,
      env: values.env,
      persistTo: values["persist-to"],
    };
    const { site } = await resolveCliSite(
      {
        async query(sql) {
          return queryD1(sql, runtime, d1Options);
        },
        async execute(sql) {
          executeD1(sql, runtime, {
            ...d1Options,
            quiet: true,
          });
        },
      },
      {
        env: process.env,
        ...siteFlags,
      },
    );

    const sql = `
      INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at")
      VALUES ('${site.id}', 'PASSWORD_RESET_TOKEN', '${value}', ${timestamp})
      ON CONFLICT ("site_id", "key") DO UPDATE
      SET "value" = excluded."value",
          "updated_at" = excluded."updated_at"
    `;

    executeD1(sql, runtime, d1Options);
  }

  console.log("");
  console.log("Password reset token generated (expires in 15 minutes).");
  console.log(`Runtime: ${getCliRuntimeLabel(runtime)}`);
  console.log(`Visit: /reset?token=${token}`);
}
