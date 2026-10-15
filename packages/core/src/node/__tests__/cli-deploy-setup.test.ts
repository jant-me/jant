import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  needsFirstDeploySetup,
  runFirstDeploySetup,
  setAccountId,
  setD1DatabaseId,
} from "../../../bin/lib/cloudflare-setup.js";

/** `wrangler.toml` the way `npm create jant my-blog` writes it. */
const SCAFFOLDED_CONFIG = `name = "my-blog"
main = "index.js"
compatibility_date = "2026-01-20"

[vars]
# SITE_ORIGIN = "https://my-blog.example.com"

[[d1_databases]]
binding = "DB"
database_name = "my-blog-db"
database_id = "local"
migrations_dir = "node_modules/@jant/core/src/db/migrations"

[[r2_buckets]]
binding = "R2"
bucket_name = "my-blog-media"
`;

const DATABASE_ID = "7c1e5f0a-2b3c-4d5e-8f90-123456789abc";

type WranglerCall = { args: string[]; options?: { stdio?: string } };

class WranglerError extends Error {
  stdout: string;
  stderr: string;

  constructor(stderr: string, stdout = "") {
    super("Command failed: wrangler");
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

const notFoundBucket = () =>
  new WranglerError(
    "✘ [ERROR] A request to the Cloudflare API (/accounts/x/r2/buckets/my-blog-media) failed.\n\n  The specified bucket does not exist. [code: 10006]\n",
  );
const notFoundWorker = () =>
  new WranglerError(
    '✘ [ERROR] Worker "my-blog" not found.\n\n  If this is a new Worker, run `wrangler deploy` first to create it.\n',
  );

/**
 * A stand-in for Wrangler with an account that starts out empty. Creating a
 * database or bucket adds it, the way the real API would.
 */
function fakeCloudflare(
  state: {
    loggedIn?: boolean;
    accounts?: { id: string; name: string }[];
    databases?: { name: string; uuid: string }[];
    buckets?: string[];
    secrets?: string[];
    r2Enabled?: boolean;
  } = {},
) {
  const account = {
    loggedIn: state.loggedIn ?? true,
    accounts: state.accounts ?? [{ id: "acc1", name: "Owen's Account" }],
    databases: [...(state.databases ?? [])],
    buckets: [...(state.buckets ?? [])],
    secrets: state.secrets ?? null,
    r2Enabled: state.r2Enabled ?? true,
  };
  const calls: WranglerCall[] = [];

  const wrangler = (args: string[], options?: { stdio?: string }) => {
    calls.push({ args, options });
    const command = args.slice(0, 3).join(" ");

    if (args[0] === "whoami") {
      const body = JSON.stringify(
        account.loggedIn
          ? { loggedIn: true, accounts: account.accounts }
          : { loggedIn: false },
      );
      if (!account.loggedIn) throw new WranglerError("", body);
      return body;
    }
    if (args[0] === "login") {
      account.loggedIn = true;
      return "";
    }
    if (command === "d1 list --json") {
      return JSON.stringify(account.databases);
    }
    if (command.startsWith("d1 create")) {
      account.databases.push({ name: args[2]!, uuid: DATABASE_ID });
      return "Successfully created DB";
    }
    if (command === "r2 bucket info" || command === "r2 bucket create") {
      if (!account.r2Enabled) {
        throw new WranglerError(
          "✘ [ERROR] A request to the Cloudflare API failed.\n\n  Please enable R2 through the Cloudflare Dashboard. [code: 10042]\n",
        );
      }
      if (command === "r2 bucket create") {
        account.buckets.push(args[3]!);
        return "Created bucket";
      }
      if (!account.buckets.includes(args[3]!)) throw notFoundBucket();
      return JSON.stringify({ name: args[3] });
    }
    if (command === "secret list --format") {
      if (account.secrets === null) throw notFoundWorker();
      return JSON.stringify(
        account.secrets.map((name) => ({ name, type: "secret_text" })),
      );
    }
    throw new Error(`Unexpected wrangler call: ${args.join(" ")}`);
  };

  return { account, calls, wrangler };
}

const terminal = { stdin: { isTTY: true }, stdout: { isTTY: true } };
const pipe = { stdin: { isTTY: false }, stdout: { isTTY: false } };

describe("first-deploy setup", () => {
  let root: string;
  const originalCwd = process.cwd();
  const cleanups: (() => void)[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jant-deploy-setup-"));
    await writeFile(join(root, "wrangler.toml"), SCAFFOLDED_CONFIG);
    process.chdir(root);
    // A developer's shell or CI may set these; the tests decide them.
    vi.stubEnv("CI", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  async function setUp(
    cloudflare: ReturnType<typeof fakeCloudflare>,
    deps: { io?: object; ask?: (question: string) => Promise<string> } = {},
  ) {
    const log = vi.fn();
    const setup = await runFirstDeploySetup(
      { configPath: "wrangler.toml", database: "DB" },
      {
        io: deps.io ?? pipe,
        log,
        ask: deps.ask,
        wrangler: cloudflare.wrangler,
      },
    );
    cleanups.push(setup.cleanup);
    return { setup, log };
  }

  const readConfig = () => readFile(join(root, "wrangler.toml"), "utf8");

  it("runs only while database_id is the scaffold placeholder", async () => {
    expect(needsFirstDeploySetup({ configPath: "wrangler.toml" })).toBe(true);

    await writeFile(
      join(root, "wrangler.toml"),
      SCAFFOLDED_CONFIG.replace('"local"', `"${DATABASE_ID}"`),
    );
    expect(needsFirstDeploySetup({ configPath: "wrangler.toml" })).toBe(false);

    await writeFile(join(root, "wrangler.toml"), '[assets]\ndirectory = "x"\n');
    expect(needsFirstDeploySetup({ configPath: "wrangler.toml" })).toBe(false);
  });

  it("creates the database, the bucket, and AUTH_SECRET on an empty account", async () => {
    const cloudflare = fakeCloudflare();
    const { setup } = await setUp(cloudflare);

    expect(cloudflare.account.databases).toEqual([
      { name: "my-blog-db", uuid: DATABASE_ID },
    ]);
    expect(cloudflare.account.buckets).toEqual(["my-blog-media"]);
    expect(await readConfig()).toBe(
      SCAFFOLDED_CONFIG.replace('"local"', `"${DATABASE_ID}"`),
    );

    const secretsFile = setup.secretsFile!;
    const secrets = JSON.parse(readFileSync(secretsFile, "utf8"));
    expect(Object.keys(secrets)).toEqual(["AUTH_SECRET"]);
    expect(secrets.AUTH_SECRET).toHaveLength(44);
    expect(statSync(secretsFile).mode & 0o777).toBe(0o600);

    setup.cleanup();
    expect(existsSync(secretsFile)).toBe(false);
  });

  it("reuses what already exists and keeps the Worker's AUTH_SECRET", async () => {
    const cloudflare = fakeCloudflare({
      databases: [{ name: "my-blog-db", uuid: DATABASE_ID }],
      buckets: ["my-blog-media"],
      secrets: ["AUTH_SECRET"],
    });
    const { setup } = await setUp(cloudflare);

    const commands = cloudflare.calls.map((call) => call.args.slice(0, 3));
    expect(commands).not.toContainEqual(["d1", "create", "my-blog-db"]);
    expect(commands).not.toContainEqual(["r2", "bucket", "create"]);
    expect(setup.secretsFile).toBeNull();
    expect(await readConfig()).toContain(`database_id = "${DATABASE_ID}"`);
  });

  it("puts the placeholder back when the deploy fails", async () => {
    const { setup } = await setUp(fakeCloudflare());
    setup.restore();
    expect(await readConfig()).toBe(SCAFFOLDED_CONFIG);
  });

  it("tells a script how to sign in instead of opening a browser", async () => {
    const cloudflare = fakeCloudflare({ loggedIn: false });
    await expect(setUp(cloudflare)).rejects.toThrow("npx wrangler login");
    expect(cloudflare.calls.map((call) => call.args[0])).not.toContain("login");
    expect(await readConfig()).toBe(SCAFFOLDED_CONFIG);
  });

  it("signs in through the browser when a person is at the terminal", async () => {
    const cloudflare = fakeCloudflare({ loggedIn: false });
    await setUp(cloudflare, { io: terminal });
    expect(cloudflare.calls).toContainEqual({
      args: ["login"],
      options: { stdio: "inherit" },
    });
  });

  it("lists the accounts for a script when the sign-in reaches several", async () => {
    const cloudflare = fakeCloudflare({
      accounts: [
        { id: "acc1", name: "Personal" },
        { id: "acc2", name: "Work" },
      ],
    });
    await expect(setUp(cloudflare)).rejects.toThrow(
      /Personal \(acc1\)[\s\S]*Work \(acc2\)/,
    );
    expect(cloudflare.calls.map((call) => call.args[0])).not.toContain("d1");
  });

  it("asks a person which account to use and remembers it", async () => {
    const cloudflare = fakeCloudflare({
      accounts: [
        { id: "acc1", name: "Personal" },
        { id: "acc2", name: "Work" },
      ],
    });
    const ask = vi.fn(async () => "2");
    const { setup } = await setUp(cloudflare, { io: terminal, ask });

    expect(ask).toHaveBeenCalledOnce();
    const config = await readConfig();
    expect(config).toMatch(/^name = "my-blog"\naccount_id = "acc2"\n/);

    // A failed deploy keeps the choice.
    setup.restore();
    expect(await readConfig()).toContain('account_id = "acc2"');
    expect(await readConfig()).toContain('database_id = "local"');
  });

  it("skips the account question when wrangler.toml names one", async () => {
    await writeFile(
      join(root, "wrangler.toml"),
      setAccountId(SCAFFOLDED_CONFIG, "acc2"),
    );
    const cloudflare = fakeCloudflare({
      accounts: [
        { id: "acc1", name: "Personal" },
        { id: "acc2", name: "Work" },
      ],
    });
    const ask = vi.fn(async () => "1");
    await setUp(cloudflare, { io: terminal, ask });
    expect(ask).not.toHaveBeenCalled();
  });

  it("says where to enable R2 when the account hasn't", async () => {
    const cloudflare = fakeCloudflare({ r2Enabled: false });
    await expect(setUp(cloudflare)).rejects.toThrow(
      /R2 isn't enabled[\s\S]*dash\.cloudflare\.com/,
    );
    expect(await readConfig()).toBe(SCAFFOLDED_CONFIG);
  });

  it("leaves R2 alone in a project without buckets", async () => {
    await writeFile(
      join(root, "wrangler.toml"),
      SCAFFOLDED_CONFIG.replace(/\n\[\[r2_buckets\]\][^[]*/s, "\n"),
    );
    const cloudflare = fakeCloudflare();
    await setUp(cloudflare);
    expect(cloudflare.calls.map((call) => call.args[0])).not.toContain("r2");
  });
});

describe("setD1DatabaseId", () => {
  it("replaces the binding's database_id and keeps the rest of the file", () => {
    const raw = `# Site config
[[d1_databases]]
binding = "OTHER"
database_name = "other"
database_id = "keep-me"

[[d1_databases]]
binding = "DB"
database_name = "my-blog-db"
database_id = "local" # set on first deploy
`;
    expect(setD1DatabaseId(raw, { binding: "DB", databaseId: "new-id" })).toBe(
      raw.replace('"local"', '"new-id"'),
    );
  });

  it("adds database_id after database_name when the entry has none", () => {
    const raw = `[[d1_databases]]
binding = "DB"
database_name = "my-blog-db"
migrations_dir = "migrations"
`;
    expect(setD1DatabaseId(raw, { binding: "DB", databaseId: "new-id" })).toBe(
      `[[d1_databases]]
binding = "DB"
database_name = "my-blog-db"
database_id = "new-id"
migrations_dir = "migrations"
`,
    );
  });

  it("writes into the named environment's entry", () => {
    const raw = `[[d1_databases]]
binding = "DB"
database_id = "local"

[[env.staging.d1_databases]]
binding = "DB"
database_id = "local"
`;
    expect(
      setD1DatabaseId(raw, {
        binding: "DB",
        databaseId: "staging-id",
        env: "staging",
      }),
    ).toBe(raw.replace(/"local"\n$/, '"staging-id"\n'));
  });

  it("fails when no entry has the binding", () => {
    expect(() =>
      setD1DatabaseId('[[d1_databases]]\nbinding = "OTHER"\n', {
        binding: "DB",
        databaseId: "x",
      }),
    ).toThrow('No [[d1_databases]] entry for binding "DB"');
  });
});
