import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { and, asc, eq } from "drizzle-orm";
import { hashPassword } from "../../src/lib/password.js";
import { now } from "../../src/lib/time.js";
import {
  applyNodeRuntimeEnvDefaults,
  createNodeBindings,
} from "../../src/node/request-handler.js";
import type { Bindings } from "../../src/types/bindings.js";
import {
  describeScriptEnvPath,
  readScriptEnvFile,
  resolveScriptEnvPath,
} from "../script-env.js";
import { DEFAULT_DEV_PASSWORD, DEV_EMAIL } from "./dev-auth-db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(__dirname, "../..");
const defaultDataDir = resolve(coreDir, "data");

function printHelp() {
  console.log(
    "Usage: node dev/run-script.mjs dev/scripts/sync-dev-password.ts [password]",
  );
  console.log("");
  console.log(
    "Update the local Node admin password to match DEMO_PASSWORD in .env.node,",
  );
  console.log(
    "or the positional argument if provided. Only re-hashes the existing",
  );
  console.log("admin's password — does not reset the database.");
  console.log("");
  console.log("Resolution order: CLI arg, $DEMO_PASSWORD, .env.node, default.");
}

export default async function main(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const envPath = resolveScriptEnvPath();
  const envFileValues = readScriptEnvFile(envPath);
  const password =
    positionals[0]?.trim() ||
    process.env.DEMO_PASSWORD?.trim() ||
    envFileValues.DEMO_PASSWORD?.trim() ||
    DEFAULT_DEV_PASSWORD;

  const env = {
    ...envFileValues,
    ...process.env,
    DEMO_EMAIL: process.env.DEMO_EMAIL || envFileValues.DEMO_EMAIL || DEV_EMAIL,
    DEMO_PASSWORD: password,
  } as Bindings;

  applyNodeRuntimeEnvDefaults(env, {
    cwd: coreDir,
    defaultDataDir,
  });

  const { bindings, close } = await createNodeBindings(env);
  try {
    const nodeDatabase = bindings.NODE_DATABASE;
    if (!nodeDatabase) {
      throw new Error("Node database binding is missing.");
    }

    const { db, schema } = nodeDatabase;
    const credentialUsers = await db
      .select({
        accountRowId: schema.account.id,
        email: schema.user.email,
        userId: schema.user.id,
      })
      .from(schema.user)
      .innerJoin(
        schema.account,
        and(
          eq(schema.account.userId, schema.user.id),
          eq(schema.account.providerId, "credential"),
        ),
      )
      .orderBy(asc(schema.user.createdAt))
      .limit(1);

    const target = credentialUsers[0];
    if (!target) {
      console.error("No credential user found in the local Node database.");
      console.error(
        "Run `mise run db-node-rebuild-demo` first to bootstrap an admin.",
      );
      process.exit(1);
    }

    const hashedPassword = await hashPassword(password);
    const timestamp = new Date(now() * 1000);
    await db
      .update(schema.account)
      .set({ password: hashedPassword, updatedAt: timestamp })
      .where(eq(schema.account.id, target.accountRowId));

    console.log("");
    console.log("Local Node admin password synced.");
    console.log(`  Env file: ${describeScriptEnvPath(envPath)}`);
    console.log(`  Email:    ${target.email}`);
    console.log(`  Password: ${password}`);
  } finally {
    await close();
  }
}
