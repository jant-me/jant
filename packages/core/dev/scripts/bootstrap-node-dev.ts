import { parseArgs } from "node:util";
import { migrate } from "../../src/node/request-handler.js";
import type { SetUpInstanceOutcome } from "../../src/services/bootstrap.js";
import {
  applyNodeDevCredentials,
  loadNodeDevEnv,
  printNodeDevSignIn,
  resolveNodeDevTarget,
  setUpNodeDevSite,
  type NodeDevCredentials,
  type NodeDevSignIn,
} from "../node-dev-site.js";
import { describeScriptEnvPath } from "../script-env.js";

const TASK = "db-node-bootstrap-shell";

const SETUP_OUTCOMES: Record<SetUpInstanceOutcome, string> = {
  created: "created the site and the dev account",
  resumed: "finished the setup an earlier run started",
  "already-set-up": "already set up, left unchanged",
};

function printHelp() {
  console.log(
    "Usage: node dev/run-script.mjs dev/scripts/bootstrap-node-dev.ts [password] [--check]",
  );
  console.log("");
  console.log(
    "Migrate the local Node database and set up its site: the dev account, default navigation, and completed onboarding.",
  );
  console.log(
    "Writes AUTH_SECRET, DEV_API_TOKEN, DEMO_EMAIL, and DEMO_PASSWORD to the env file.",
  );
  console.log("");
  console.log(
    "Adds no content. A site that finished setup is left unchanged, account included.",
  );
  console.log("Works with SQLite and PostgreSQL.");
  console.log("");
  console.log(
    "Password: the argument, then $DEMO_PASSWORD, then DEMO_PASSWORD in the env file, then the default.",
  );
}

function printSignInProblem(
  signIn: NodeDevSignIn,
  credentials: NodeDevCredentials,
) {
  if (signIn === "no-account") {
    console.log(
      `The site's account is not ${credentials.email}, so these credentials and the auto-login URL do not sign in.`,
    );
    console.log(
      "Sign in with that account, or run this task again on an empty database (on SQLite, `mise run db-node-clean` empties it).",
    );
  } else if (signIn === "wrong-password") {
    console.log(
      `${credentials.email} has a different password, so the auto-login URL does not sign in.`,
    );
    console.log(
      "Run `mise run dev-auth-sync` to set the password above on the account.",
    );
  }
}

export default async function main(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const devEnv = loadNodeDevEnv();
  const target = resolveNodeDevTarget(devEnv.env, { task: TASK });

  if (values.check) {
    console.log("Node shell prerequisites look good.");
    console.log(`  Env file:  ${describeScriptEnvPath(devEnv.envPath)}`);
    console.log(`  Database:  ${target.database} (${target.dialect})`);
    return;
  }

  const credentials = applyNodeDevCredentials(devEnv, {
    cliPassword: positionals[0],
    write: true,
  });

  console.log("Running Node migrations...");
  await migrate(devEnv.env);

  console.log("Setting up the local development site...");
  const setup = await setUpNodeDevSite(devEnv.env, credentials);

  console.log("");
  console.log("Local Node shell is ready.");
  console.log(`  Env file:  ${describeScriptEnvPath(devEnv.envPath)}`);
  console.log(`  Database:  ${target.database} (${target.dialect})`);
  console.log(`  Setup:     ${SETUP_OUTCOMES[setup.outcome]}`);
  console.log(`  Email:     ${credentials.email}`);
  console.log(`  Password:  ${credentials.password}`);
  console.log(`  Dev token: ${credentials.devApiToken}`);
  console.log("");
  if (setup.signIn !== "ok") {
    printSignInProblem(setup.signIn, credentials);
    console.log("");
  }
  printNodeDevSignIn(devEnv.env, credentials);
}
