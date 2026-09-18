import { parseArgs } from "node:util";
import { and, asc, eq } from "drizzle-orm";
import { hashPassword } from "../../src/lib/password.js";
import { now } from "../../src/lib/time.js";
import { createNodeBindings } from "../../src/node/request-handler.js";
import { loadNodeDevEnv, resolveNodeDevPassword } from "../node-dev-site.js";
import { describeScriptEnvPath } from "../script-env.js";

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

  const devEnv = loadNodeDevEnv();
  const password = resolveNodeDevPassword(devEnv, positionals[0]);

  const { bindings, close } = await createNodeBindings(devEnv.env);
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
        "Run `mise run db-node-bootstrap-shell` first to set up the dev account.",
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
    console.log(`  Env file: ${describeScriptEnvPath(devEnv.envPath)}`);
    console.log(`  Email:    ${target.email}`);
    console.log(`  Password: ${password}`);
  } finally {
    await close();
  }
}
