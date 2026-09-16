import { parseArgs } from "node:util";
import { loadNodeRuntime } from "../lib/load-node-runtime.js";
import { openNodeDatabase } from "../lib/node-database.js";
import { bootstrapCliRuntime } from "../lib/runtime-target.js";

function printHelp() {
  console.log(
    "Usage: jant setup --email <address> --password-stdin [--site-name <name>] [--language <tag>] [--time-zone <zone>] [--site-id <id>]",
  );
  console.log("");
  console.log(
    "Set up a self-hosted install without the browser: the owner account, the site, and onboarding.",
  );
  console.log("Does the same as the two /setup screens.");
  console.log("");
  console.log("Options:");
  console.log("  --email           The owner's sign-in address");
  console.log(
    "  --password-stdin  Read the owner's password from standard input",
  );
  console.log(
    "  --site-name       The site's name (default: the built-in fallback name)",
  );
  console.log(
    "  --language        Language the site publishes in, as a BCP 47 tag (default: en)",
  );
  console.log("  --time-zone       The site's IANA time zone (default: UTC)");
  console.log(
    "  --site-id         Create the site with this id instead of a random one",
  );
  console.log(
    "  --node            Force Node runtime even if DATABASE_URL is unset",
  );
  console.log("");
  console.log("Safe to run on every start. An install that has finished setup");
  console.log(
    "is left unchanged, so a password changed since then is not reset.",
  );
  console.log("");
  console.log("Example:");
  console.log(
    `  printf '%s' "$OWNER_PASSWORD" | jant setup --email owner@example.com --password-stdin`,
  );
  console.log("");
  console.log(
    "Node runtime and SITE_RESOLUTION_MODE=single-site only. `.env.node` next to",
  );
  console.log("your project (or in packages/core/) is auto-loaded.");
}

/**
 * Read a secret piped to the command, the way `docker login --password-stdin`
 * does: everything on the stream, minus the one line break `echo` adds.
 *
 * @param stream - Where the secret arrives
 * @returns The secret
 */
async function readPasswordFromStdin(stream) {
  if (stream.isTTY) {
    throw new Error(
      "--password-stdin reads the password from a pipe. Example: printf '%s' \"$OWNER_PASSWORD\" | jant setup --email <address> --password-stdin",
    );
  }

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

const OUTCOME_MESSAGES = {
  created: (siteId) => `Set up site ${siteId}.`,
  resumed: (siteId) =>
    `Finished setting up site ${siteId}, which an earlier run had started.`,
  "already-set-up": (siteId) =>
    `Site ${siteId} was already set up. Nothing changed.`,
};

export async function run(argv, io = { stdin: process.stdin }) {
  const { values } = parseArgs({
    args: argv,
    options: {
      email: { type: "string" },
      help: { type: "boolean", short: "h" },
      language: { type: "string" },
      node: { type: "boolean", default: false },
      "password-stdin": { type: "boolean", default: false },
      "site-id": { type: "string" },
      "site-name": { type: "string" },
      "time-zone": { type: "string" },
    },
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (!values.email) {
    throw new Error("Pass the owner's sign-in address with --email.");
  }
  if (!values["password-stdin"]) {
    throw new Error(
      "Pass --password-stdin and pipe the owner's password in. The password is never read from an argument, where it would show up in the process list.",
    );
  }

  const { runtime } = bootstrapCliRuntime(values);
  if (runtime !== "node") {
    throw new Error(
      "jant setup runs against a Node database. Set DATABASE_URL or DATA_DIR, or pass --node.",
    );
  }

  const password = await readPasswordFromStdin(io.stdin);
  const { setUpNodeInstance } = await loadNodeRuntime();
  const nodeDatabase = await openNodeDatabase(process.env);

  try {
    const result = await setUpNodeInstance(nodeDatabase.bindings, {
      email: values.email,
      password,
      siteId: values["site-id"],
      siteName: values["site-name"],
      siteLanguage: values.language,
      timeZone: values["time-zone"],
    });
    console.log(OUTCOME_MESSAGES[result.outcome](result.siteId));
    return result;
  } finally {
    await nodeDatabase.close();
  }
}
