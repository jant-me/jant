#!/usr/bin/env node
/**
 * Integration test for the create-jant template.
 *
 * Scaffolds a project the way `pnpm create jant` does — `pnpm dlx` on the
 * packed create-jant — installs it with the same pnpm, and checks the result:
 * the pnpm pin and build approvals, the native better-sqlite3 build, the
 * pre-built client assets from @jant/core, the generated files, and a deploy
 * workflow that installs with pnpm. Then scaffolds with npm and Yarn 1,
 * without installing, to check their deploy workflows: npm's is the demo's
 * unchanged. Last, scaffolds through `yarn dlx` with Yarn 2+, installs with
 * the Yarn it pins, and checks the build approvals, the node_modules linker,
 * `jant migrate --local`, and the deploy workflow.
 *
 * Usage: node scripts/test-template.js [path-to-core-tarball]
 *
 * If no tarball path is provided, it will pack @jant/core automatically.
 * The scaffold and install use the `pnpm` on PATH; to test another version,
 * put it first, e.g. `mise exec pnpm@12 -- node scripts/test-template.js`.
 * Yarn 2+ runs through Corepack at {@link YARN_BERRY_VERSION}; set
 * TEST_YARN_VERSION to test another. create-jant must already be built
 * (`pnpm --filter create-jant prepublishOnly`).
 */
import fs from "fs-extra";
import path from "path";
import { execSync, spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import os from "os";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const DEMO_WORKFLOW = path.join(
  MONOREPO_ROOT,
  "sites/demo/.github/workflows/deploy.yml",
);
const WORKFLOW = ".github/workflows/deploy.yml";

/**
 * Yarn 2+ release the Yarn scaffold runs with. Yarn is not a tool of this
 * repository, so it comes through Corepack, at a pinned version like the pnpm
 * the rest of the test runs with.
 */
const YARN_BERRY_VERSION = process.env.TEST_YARN_VERSION ?? "4.18.1";

/**
 * Corepack that runs Yarn. Node 25 and later don't ship one, and a
 * devDependency would put Corepack's `pnpm` and `yarn` shims on the PATH of
 * `pnpm test-template`, in front of the pnpm under test. So the test installs
 * it into its own directory.
 */
const COREPACK_VERSION = "0.36.0";

/**
 * Yarn 4 drops registry connections now and then, and its own retries don't
 * cover it: the command fails within a second or two with "write ECANCELED
 * Canceled because of SSL destruction" or ERR_SOCKET_CLOSED_BEFORE_CONNECTION.
 * On a macOS machine one fresh resolution in five failed that way, on Yarn
 * 4.17 and 4.18 and against either registry, while pnpm and npm never did;
 * other projects report the same error in CI. The Yarn steps that reach the
 * registry retry on it.
 */
const YARN_NETWORK_RETRY = {
  on: /\b(ECANCELED|ECONNRESET|ETIMEDOUT|ERR_SOCKET_CLOSED_BEFORE_CONNECTION)\b/,
  attempts: 4,
};

/** What the deploy workflow of a pnpm or yarn scaffold runs. */
const EXPECTED_WORKFLOW = {
  pnpm: {
    cache: "pnpm",
    install: "pnpm install --frozen-lockfile",
    wrangler: "pnpm exec wrangler",
  },
  "yarn-classic": {
    cache: "yarn",
    install: "yarn install --frozen-lockfile",
    wrangler: "yarn wrangler",
  },
  "yarn-berry": {
    cache: "yarn",
    install: "yarn install --immutable",
    wrangler: "yarn wrangler",
  },
};

function fail(message) {
  console.error(`  ${message}`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function runCapture(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", ...opts }).trim();
}

/**
 * Run a command, print its output as it would with `run`, and return it.
 *
 * @param retry - `{ on, attempts }`: run up to `attempts` times while a failed
 *   run's output matches `on`
 */
function runTee(cmd, opts = {}, retry = { on: null, attempts: 1 }) {
  for (let attempt = 1; ; attempt++) {
    console.log(`  $ ${cmd}`);
    const result = spawnSync(cmd, { shell: true, encoding: "utf-8", ...opts });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status === 0) {
      return result.stdout;
    }
    const match = retry.on?.exec(`${result.stdout}${result.stderr}`);
    if (attempt >= retry.attempts || !match) {
      fail(`"${cmd}" exited with ${result.status ?? result.signal}`);
    }
    console.log(`  Retrying after ${match[0]}`);
  }
}

/** Pack a workspace package into `destination` and return the tarball path. */
function pack(packageDir, destination) {
  const output = runCapture(`pnpm pack --pack-destination ${destination}`, {
    cwd: packageDir,
  });
  return output.split("\n").pop();
}

/**
 * Load better-sqlite3 the way @jant/core does, to prove its install script
 * built the native binding.
 */
async function checkBetterSqlite(projectDir) {
  const coreRequire = createRequire(
    path.join(
      await fs.realpath(path.join(projectDir, "node_modules/@jant/core")),
      "package.json",
    ),
  );
  const Database = coreRequire("better-sqlite3");
  new Database(":memory:").close();
}

/**
 * Check that a scaffold's deploy workflow sets up, caches, installs, and runs
 * wrangler with the package manager of `target`, and nowhere with npm.
 *
 * @param target - "pnpm", "yarn-classic" (Yarn 1), or "yarn-berry" (Yarn 2+)
 * @returns the workflow's install command and its wrangler command prefix
 */
async function checkDeployWorkflow(projectDir, target) {
  const expected = EXPECTED_WORKFLOW[target];
  const content = await fs.readFile(path.join(projectDir, WORKFLOW), "utf-8");
  for (const npmUse of ["npm ci", "cache: npm", "npx "]) {
    if (content.includes(npmUse)) {
      fail(`${target} workflow still contains "${npmUse}"`);
    }
  }

  const steps = parseYaml(content).jobs.deploy.steps;
  const stepIndex = (name) => {
    const index = steps.findIndex((step) => step.name === name);
    if (index === -1) fail(`${target} workflow has no "${name}" step`);
    return index;
  };

  // setup-node runs the package manager to find the directory it caches, so
  // the right one has to be on PATH first. Yarn 1 comes with GitHub's
  // runners; pnpm and Yarn 2+ don't.
  const nodeIndex = stepIndex("Setup Node.js");
  const pnpmSetupIndex = steps.findIndex((step) =>
    step.uses?.startsWith("pnpm/action-setup@"),
  );
  const corepackIndex = steps.findIndex((step) =>
    /\bcorepack\b/.test(step.run ?? ""),
  );
  if (target === "pnpm") {
    if (pnpmSetupIndex === -1 || pnpmSetupIndex > nodeIndex) {
      fail("pnpm workflow does not run pnpm/action-setup before setup-node");
    }
    // The version comes from the packageManager pin; passing one as well
    // makes pnpm/action-setup fail when the two differ.
    if (steps[pnpmSetupIndex].with?.version !== undefined) {
      fail("pnpm workflow passes pnpm/action-setup a version");
    }
  } else if (pnpmSetupIndex !== -1) {
    fail(`${target} workflow sets up pnpm`);
  }
  if (target === "yarn-berry") {
    // The runner's Yarn 1 refuses a project that pins Yarn 2+, so Corepack
    // has to replace it before setup-node. Node 25 and later don't ship
    // Corepack, so the step installs it from npm.
    if (corepackIndex === -1 || corepackIndex > nodeIndex) {
      fail("Yarn 2+ workflow does not install Corepack before setup-node");
    }
    if (!/\bnpm install --global corepack\b/.test(steps[corepackIndex].run)) {
      fail("Yarn 2+ workflow relies on a Corepack that comes with Node");
    }
  } else if (corepackIndex !== -1) {
    fail(`${target} workflow sets up Corepack`);
  }

  const cache = steps[nodeIndex].with?.cache;
  if (cache !== expected.cache) {
    fail(`${target} workflow caches ${cache}, expected ${expected.cache}`);
  }

  const install = steps[stepIndex("Install dependencies")].run;
  if (install !== expected.install) {
    fail(`${target} workflow installs with "${install}"`);
  }

  const migrate = steps[stepIndex("Run migrations")].run;
  if (!migrate.startsWith(`${expected.wrangler} d1 migrations apply `)) {
    fail(`${target} workflow migrates with "${migrate}"`);
  }

  return { install, wrangler: expected.wrangler };
}

async function main() {
  console.log("Testing create-jant template...\n");

  const testDir = path.join(os.tmpdir(), `create-jant-test-${Date.now()}`);
  const projectDir = path.join(testDir, "test-project");
  await fs.ensureDir(testDir);

  // 1. Pack @jant/core into a tarball
  let coreTarball = process.argv[2];
  if (!coreTarball) {
    console.log("Step 1: Building and packing @jant/core...");
    const coreDir = path.resolve(MONOREPO_ROOT, "packages/core");
    run("pnpm run build", { cwd: coreDir });
    coreTarball = pack(coreDir, testDir);
    console.log(`  Tarball: ${coreTarball}\n`);
  } else {
    coreTarball = path.resolve(coreTarball);
    console.log(`Step 1: Using provided tarball: ${coreTarball}\n`);
  }

  // 2. Pack create-jant as it would be published
  console.log("Step 2: Packing create-jant...");
  for (const built of ["dist/index.js", "template/package.json"]) {
    if (!(await fs.pathExists(path.join(PACKAGE_ROOT, built)))) {
      fail(
        `${built} not found. Run "pnpm --filter create-jant prepublishOnly" first.`,
      );
    }
  }
  // A unique path per run: `pnpm dlx` caches by specifier, so reusing one
  // would run a stale copy of the CLI.
  const createJantTarball = pack(PACKAGE_ROOT, testDir);
  console.log(`  Tarball: ${createJantTarball}\n`);

  // 3. Scaffold the project the way `pnpm create jant` does, so the CLI sees
  // a real pnpm user agent.
  const pnpmVersion = runCapture("pnpm --version", { cwd: testDir });
  console.log(`Step 3: Scaffolding project with pnpm ${pnpmVersion}...`);
  run(`pnpm dlx ${createJantTarball} test-project -y --no-install --no-git`, {
    cwd: testDir,
  });

  const pkgPath = path.join(projectDir, "package.json");
  const pkg = await fs.readJson(pkgPath);
  if (pkg.packageManager !== `pnpm@${pnpmVersion}`) {
    fail(
      `package.json pins ${pkg.packageManager ?? "no package manager"}, expected pnpm@${pnpmVersion}`,
    );
  }
  if (!(await fs.pathExists(path.join(projectDir, "pnpm-workspace.yaml")))) {
    fail("pnpm-workspace.yaml was not generated");
  }
  console.log(
    `  packageManager pinned to pnpm@${pnpmVersion}, pnpm-workspace.yaml present\n`,
  );

  // 4. Replace @jant/core dependency with local tarball
  console.log("Step 4: Linking local @jant/core...");
  pkg.dependencies["@jant/core"] = `file:${coreTarball}`;
  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
  console.log(`  Replaced @jant/core with file:${coreTarball}\n`);

  // 5. Install dependencies. pnpm 11 and later fail the install on any
  // dependency whose build script pnpm-workspace.yaml does not approve; pnpm 10
  // only warns and skips the build. Strict mode makes pnpm 10 fail the same
  // way, so a gap in create-jant's approvals fails this test on every version.
  console.log("Step 5: Installing dependencies...");
  run("pnpm install --no-frozen-lockfile", {
    cwd: projectDir,
    env: { ...process.env, npm_config_strict_dep_builds: "true" },
  });
  console.log();

  // 6. The approvals took effect: better-sqlite3's install script produced
  // the native binding that @jant/core loads.
  console.log("Step 6: Verifying better-sqlite3 native build...");
  await checkBetterSqlite(projectDir);
  console.log("  better-sqlite3 opens a database\n");

  // 7. Verify client assets exist
  console.log("Step 7: Verifying client assets...");
  const clientDir = path.join(
    projectDir,
    "node_modules/@jant/core/dist/client",
  );
  const assetDir = path.join(clientDir, "_assets");

  const assetFiles = await fs.readdir(assetDir).catch(() => []);
  const hasClientJs = assetFiles.some(
    (f) => f === "client.js" || /^client[-\w]+\.js$/.test(f),
  );
  const hasClientCss = assetFiles.some(
    (f) => f === "client.css" || /^client[-\w]+\.css$/.test(f),
  );

  if (!hasClientJs) {
    fail(`client.js not found in ${assetDir}`);
  }
  if (!hasClientCss) {
    fail(`client.css not found in ${assetDir}`);
  }
  console.log("  _assets/client.js and _assets/client.css found\n");

  // 8. Verify public asset directory generation
  console.log("Step 8: Verifying public asset directory generation...");
  run("pnpm exec jant assets prepare", {
    cwd: projectDir,
  });
  const publicAssetDir = path.join(projectDir, "dist/public/_assets");
  const preparedFiles = await fs.readdir(publicAssetDir).catch(() => []);
  const hasPreparedClientJs = preparedFiles.some(
    (f) => f === "client.js" || /^client[-\w]+\.js$/.test(f),
  );
  if (!hasPreparedClientJs) {
    fail(`prepared client.js not found at ${publicAssetDir}`);
  }
  console.log("  Public asset directory prepared at dist/public\n");

  // 9. Verify wrangler.toml is valid
  console.log("Step 9: Verifying wrangler.toml...");
  const wranglerToml = await fs.readFile(
    path.join(projectDir, "wrangler.toml"),
    "utf-8",
  );
  if (!wranglerToml.includes("test-project")) {
    fail("wrangler.toml does not contain project name");
  }
  console.log("  wrangler.toml looks correct\n");

  // 10. Verify dotfiles were renamed correctly
  console.log("Step 10: Verifying dotfiles...");
  const expectedFiles = [
    ".gitignore",
    ".github/workflows/deploy.yml",
    "README.md",
    ".dev.vars.example",
    "AGENTS.md",
    "CLAUDE.md",
  ];
  for (const file of expectedFiles) {
    if (!(await fs.pathExists(path.join(projectDir, file)))) {
      fail(`Missing expected file: ${file}`);
    }
  }
  const staleFiles = ["_gitignore", "_github"];
  for (const file of staleFiles) {
    if (await fs.pathExists(path.join(projectDir, file))) {
      fail(`Underscore-prefixed file should have been renamed: ${file}`);
    }
  }
  console.log("  All dotfiles present and correctly renamed\n");

  // 11. The deploy workflow installs with pnpm, and its commands work on the
  // project: the install passes on the lock file the scaffold produced, and
  // the migration step's prefix finds wrangler.
  console.log("Step 11: Verifying the pnpm deploy workflow...");
  const pnpmWorkflow = await checkDeployWorkflow(projectDir, "pnpm");
  run(pnpmWorkflow.install, {
    cwd: projectDir,
    env: { ...process.env, CI: "true" },
  });
  run(`${pnpmWorkflow.wrangler} --version`, { cwd: projectDir });
  console.log("  deploy.yml sets up, caches, and installs with pnpm\n");

  // 12. npm and Yarn 1 scaffolds. npm's workflow is the demo's byte for byte,
  // as `npm create jant` and jant-starter ship it. The npm scaffold runs
  // through `npm exec` like `npm create jant`, from an environment without the
  // npm_* variables this script inherits from pnpm, which npm would read as
  // its own config and pass on as its user agent. Yarn 1 can't run a tarball,
  // so its scaffold gets Yarn 1's user agent, the way sync-starter passes
  // npm's.
  console.log("Step 12: Verifying the npm and Yarn 1 deploy workflows...");
  const shellEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toLowerCase().startsWith("npm_"),
    ),
  );
  run(
    `npm exec --yes --package=${createJantTarball} -- create-jant npm-project -y --no-install --no-git`,
    { cwd: testDir, env: shellEnv },
  );
  const npmWorkflow = await fs.readFile(
    path.join(testDir, "npm-project", WORKFLOW),
  );
  if (!npmWorkflow.equals(await fs.readFile(DEMO_WORKFLOW))) {
    fail(
      `npm workflow differs from ${path.relative(MONOREPO_ROOT, DEMO_WORKFLOW)}`,
    );
  }

  run(
    `node ${path.join(PACKAGE_ROOT, "dist/index.js")} yarn1-project -y --no-install --no-git`,
    {
      cwd: testDir,
      env: {
        ...shellEnv,
        npm_config_user_agent: `yarn/1.22.22 npm/? node/${process.version} ${process.platform} ${process.arch}`,
      },
    },
  );
  const yarn1Dir = path.join(testDir, "yarn1-project");
  await checkDeployWorkflow(yarn1Dir, "yarn-classic");
  const yarn1Pkg = await fs.readJson(path.join(yarn1Dir, "package.json"));
  if (yarn1Pkg.packageManager !== undefined) {
    fail(`Yarn 1 scaffold pins ${yarn1Pkg.packageManager}`);
  }
  for (const berryFile of [".yarnrc.yml", "yarn.lock"]) {
    if (await fs.pathExists(path.join(yarn1Dir, berryFile))) {
      fail(`Yarn 1 scaffold has a ${berryFile}`);
    }
  }
  console.log(
    "  npm workflow matches the demo, Yarn 1 workflow installs with Yarn 1\n",
  );

  // 13. Yarn 2+, scaffolded the way `yarn create jant` runs it: `yarn dlx`,
  // which passes its own user agent. The project lands inside another Yarn
  // project, where Yarn refuses to install it unless the scaffold's own
  // yarn.lock marks it as a project of its own.
  console.log(
    `Step 13: Scaffolding and installing with Yarn ${YARN_BERRY_VERSION}...`,
  );
  const corepackDir = path.join(testDir, "corepack");
  run(
    `npm install --prefix ${corepackDir} --no-audit --no-fund corepack@${COREPACK_VERSION}`,
    { env: shellEnv },
  );
  const corepack = path.join(corepackDir, "node_modules/.bin/corepack");
  const yarnHostDir = path.join(testDir, "yarn-host");
  await fs.outputJson(path.join(yarnHostDir, "package.json"), {
    name: "yarn-host",
    private: true,
  });
  await fs.outputFile(path.join(yarnHostDir, "yarn.lock"), "");
  runTee(
    `${corepack} yarn@${YARN_BERRY_VERSION} dlx -p create-jant@file:${createJantTarball} create-jant yarn-berry-project -y --no-install --no-git`,
    { cwd: yarnHostDir, env: shellEnv },
    YARN_NETWORK_RETRY,
  );

  const berryDir = path.join(yarnHostDir, "yarn-berry-project");
  const berryPkgPath = path.join(berryDir, "package.json");
  const berryPkg = await fs.readJson(berryPkgPath);
  if (berryPkg.packageManager !== `yarn@${YARN_BERRY_VERSION}`) {
    fail(
      `Yarn 2+ scaffold pins ${berryPkg.packageManager ?? "no package manager"}, expected yarn@${YARN_BERRY_VERSION}`,
    );
  }
  // Plug'n'Play leaves no node_modules for wrangler.toml and the jant CLI to
  // read @jant/core's migrations and client assets from.
  const yarnrc = parseYaml(
    await fs.readFile(path.join(berryDir, ".yarnrc.yml"), "utf-8"),
  );
  if (yarnrc?.nodeLinker !== "node-modules") {
    fail(
      `.yarnrc.yml sets nodeLinker to ${yarnrc?.nodeLinker}, expected node-modules`,
    );
  }

  berryPkg.dependencies["@jant/core"] = `file:${coreTarball}`;
  await fs.writeJson(berryPkgPath, berryPkg, { spaces: 2 });
  // The install fills the empty lock file, which CI's default immutability
  // forbids. Yarn 4.14 and later skip unapproved build scripts with a YN0004
  // warning rather than failing, so the warning shows a gap in the approvals.
  const installLog = runTee(
    `${corepack} yarn install --no-immutable`,
    { cwd: berryDir, env: shellEnv },
    YARN_NETWORK_RETRY,
  );
  const skippedBuilds = installLog
    .split("\n")
    .filter((line) => line.includes("YN0004"));
  if (skippedBuilds.length > 0) {
    fail(`Yarn skipped build scripts:\n${skippedBuilds.join("\n")}`);
  }
  await checkBetterSqlite(berryDir);
  run(`${corepack} yarn jant migrate --local`, {
    cwd: berryDir,
    env: shellEnv,
  });

  const berryWorkflow = await checkDeployWorkflow(berryDir, "yarn-berry");
  run(`${corepack} ${berryWorkflow.install}`, {
    cwd: berryDir,
    env: { ...shellEnv, CI: "true" },
  });
  run(`${corepack} ${berryWorkflow.wrangler} --version`, {
    cwd: berryDir,
    env: shellEnv,
  });

  runCapture("git init -q", { cwd: berryDir });
  const checkIgnore = spawnSync(
    "git",
    ["check-ignore", "-q", ".yarn/install-state.gz"],
    { cwd: berryDir },
  );
  if (checkIgnore.status !== 0) {
    fail(".gitignore does not ignore Yarn's install state");
  }
  console.log(
    "  builds approved, better-sqlite3 opens a database, jant migrate runs, deploy.yml installs with Yarn 2+ through Corepack\n",
  );

  // Cleanup
  await fs.remove(testDir);

  console.log("Template integration test passed!");
}

main().catch((error) => {
  console.error("\nTemplate integration test failed:", error.message);
  process.exit(1);
});
