import { program } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execSync } from "child_process";
import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @jant/core version - injected at build time by prepublish script
const CORE_VERSION = "__JANT_CORE_VERSION__";
const WRANGLER_VERSION = "__WRANGLER_VERSION__";

// Template directory resolution:
// - If template/ exists next to dist/ (after prepublish copy), use that
// - Otherwise, use the source sites/demo (for local dev)
// From dist/index.js: ../template or ../../../sites/demo
const TEMPLATE_DIR = fs.existsSync(path.resolve(__dirname, "../template"))
  ? path.resolve(__dirname, "../template")
  : path.resolve(__dirname, "../../../sites/demo");

/**
 * Dependencies of a scaffolded site whose install scripts have to run:
 * better-sqlite3 fetches or compiles the native binding that @jant/core's Node
 * runtime and CLI load, and esbuild and workerd (both through wrangler) check
 * their platform binary and fetch it when the optional dependency is missing.
 *
 * pnpm 10 skips unapproved build scripts with a warning; pnpm 11 and later fail
 * the install with ERR_PNPM_IGNORED_BUILDS. pnpm 11 also removed
 * `onlyBuiltDependencies` and stopped reading the `pnpm` field of package.json,
 * so the approvals go in `allowBuilds` in pnpm-workspace.yaml, which pnpm reads
 * from 10.26 on. Yarn 4.14 and later turn `enableScripts` off by default and
 * then build only the packages that `dependenciesMeta` in package.json marks
 * `built: true`. `mise run check-template` fails when a dependency with a
 * build script is missing here.
 */
const ALLOWED_BUILDS = ["better-sqlite3", "esbuild", "workerd"] as const;

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

type PackageManager = "pnpm" | "yarn" | "npm";

/**
 * Package managers whose deploy workflow differs from the template's npm one.
 * Yarn 1 and Yarn 2+ ("Berry") install differently enough to count as two.
 */
type DeployWorkflowTarget = "pnpm" | "yarn-classic" | "yarn-berry";

/** A step of a GitHub Actions job */
type WorkflowStep = {
  /** Lines of the comment written above the step */
  comment?: readonly string[];
  name: string;
} & ({ uses: string } | { run: string });

interface DeployWorkflowInstall {
  /** Name of the package manager in error messages */
  label: string;
  /**
   * Step that puts the manager on PATH before setup-node, which runs it to
   * find the directory it caches
   */
  setupStep: WorkflowStep | null;
  /** setup-node `cache` value */
  cache: string;
  /** Install command that fails instead of changing the lock file */
  install: string;
  /** Prefix that runs a binary from the project's dependencies */
  exec: string;
}

/**
 * Deploy workflow install steps for pnpm and yarn. npm needs none:
 * sites/demo's workflow installs with npm, and npm scaffolds ship it unchanged.
 *
 * pnpm/action-setup and Corepack take their version from the `packageManager`
 * pin that create-jant writes. GitHub's runners ship Yarn 1, which refuses to
 * install a project that pins Yarn 2+, so Yarn 2+ comes through Corepack.
 * Corepack is installed from npm because Node 25 and later no longer include
 * it; its package links the `yarn` and `pnpm` binaries itself, so the global
 * ones have to go first, as Corepack's README says. The exec prefixes are the
 * ones cloudflare/wrangler-action runs wrangler with once it finds the
 * manager's lock file.
 */
const DEPLOY_WORKFLOW_INSTALL: Record<
  DeployWorkflowTarget,
  DeployWorkflowInstall
> = {
  pnpm: {
    label: "pnpm",
    setupStep: { name: "Setup pnpm", uses: "pnpm/action-setup@v6" },
    cache: "pnpm",
    install: "pnpm install --frozen-lockfile",
    exec: "pnpm exec",
  },
  "yarn-classic": {
    label: "Yarn 1",
    setupStep: null,
    cache: "yarn",
    install: "yarn install --frozen-lockfile",
    exec: "yarn",
  },
  "yarn-berry": {
    label: "Yarn 2+",
    setupStep: {
      comment: [
        "setup-node runs yarn to find its cache, so Corepack has to replace the",
        "runner's Yarn 1 first. Corepack runs the Yarn that package.json pins.",
      ],
      name: "Install Corepack",
      run: "npm uninstall --global yarn pnpm && npm install --global corepack@latest",
    },
    cache: "yarn",
    install: "yarn install --immutable",
    exec: "yarn",
  },
};

/**
 * What Yarn 2+ says to ignore when the cache isn't committed: everything under
 * `.yarn/`, such as the install state, except the files a project shares.
 * Yarn's list also has `.pnp.*`, which the node-modules linker doesn't create.
 */
const YARN_BERRY_GITIGNORE = [
  ".yarn/*",
  "!.yarn/patches",
  "!.yarn/plugins",
  "!.yarn/releases",
  "!.yarn/sdks",
  "!.yarn/versions",
] as const;

interface DetectedPackageManager {
  name: PackageManager;
  /** Exact version, or null when it could not be determined */
  version: string | null;
}

interface ProjectConfig {
  projectName: string;
  targetDir: string;
  packageManager: DetectedPackageManager;
  install: boolean;
  git: boolean;
  s3?: boolean;
}

/**
 * Validate project name
 */
function isValidProjectName(name: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name);
}

/**
 * Sanitize project name into a valid slug
 */
function toValidProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

/**
 * Generate a secure random AUTH_SECRET (base64, 32 bytes = 44 chars)
 */
function generateAuthSecret(): string {
  return crypto.randomBytes(32).toString("base64");
}

/**
 * Read the version a package manager reports for itself.
 *
 * @param pm - package manager to ask
 * @returns the version, or null when the command is missing or prints no version
 * @example
 * readPackageManagerVersion("pnpm"); // "10.33.0"
 */
function readPackageManagerVersion(pm: PackageManager): string | null {
  try {
    const output = execSync(`${pm} --version`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return VERSION_PATTERN.test(output) ? output : null;
  } catch {
    return null;
  }
}

/**
 * Detect which package manager invoked this CLI, and its version.
 * Checks npm_config_user_agent first, then falls back to PATH availability.
 *
 * @returns the package manager name and version
 * @example
 * // npm_config_user_agent="pnpm/12.5.1 npm/? node/v24.9.0 darwin arm64"
 * detectPackageManager(); // { name: "pnpm", version: "12.5.1" }
 */
function detectPackageManager(): DetectedPackageManager {
  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    const [name, version] = (userAgent.split(" ")[0] ?? "").split("/");
    if (name === "pnpm" || name === "yarn" || name === "npm") {
      return {
        name,
        version:
          version && VERSION_PATTERN.test(version)
            ? version
            : readPackageManagerVersion(name),
      };
    }
  }

  // Fallback: check which PM is available in PATH
  for (const pm of ["pnpm", "yarn", "npm"] as const) {
    const version = readPackageManagerVersion(pm);
    if (version) {
      return { name: pm, version };
    }
  }

  return { name: "npm", version: null };
}

/**
 * Whether a scaffold is for Yarn 2 or later ("Berry") rather than Yarn 1.
 * A yarn whose version is unknown counts as Yarn 1: with no version to pin,
 * CI would install with the runner's Yarn 1.
 *
 * @param pm - the detected package manager
 * @returns true for Yarn 2 and later
 * @example
 * isYarnBerry({ name: "yarn", version: "4.18.1" }); // true
 * isYarnBerry({ name: "yarn", version: "1.22.22" }); // false
 */
function isYarnBerry(pm: DetectedPackageManager): boolean {
  if (pm.name !== "yarn" || pm.version === null) return false;
  return Number(pm.version.split(".")[0]) >= 2;
}

/**
 * Pick the deploy workflow install steps a scaffold needs.
 *
 * @param pm - the detected package manager
 * @returns the target to adapt the workflow for, or null for npm, which keeps
 *   the template's workflow
 * @example
 * deployWorkflowTarget({ name: "yarn", version: "4.18.1" }); // "yarn-berry"
 */
function deployWorkflowTarget(
  pm: DetectedPackageManager,
): DeployWorkflowTarget | null {
  switch (pm.name) {
    case "npm":
      return null;
    case "pnpm":
      return "pnpm";
    case "yarn":
      return isYarnBerry(pm) ? "yarn-berry" : "yarn-classic";
  }
}

/**
 * Render the pnpm-workspace.yaml of a scaffolded project.
 *
 * @returns YAML approving the build scripts in {@link ALLOWED_BUILDS}
 * @example
 * renderPnpmWorkspace(); // "# Dependencies ...\nallowBuilds:\n  better-sqlite3: true\n..."
 */
function renderPnpmWorkspace(): string {
  const entries = ALLOWED_BUILDS.map((name) => `  ${name}: true`);
  return [
    "# Dependencies allowed to run install scripts. pnpm blocks the build",
    "# scripts of any other dependency; approve one with `pnpm approve-builds`.",
    "allowBuilds:",
    ...entries,
    "",
  ].join("\n");
}

/**
 * Render the .yarnrc.yml of a project scaffolded with Yarn 2+.
 *
 * @returns YAML that installs into node_modules instead of Plug'n'Play
 * @example
 * renderYarnrc(); // "# wrangler.toml ...\nnodeLinker: node-modules\n"
 */
function renderYarnrc(): string {
  return [
    "# wrangler.toml and the jant CLI read @jant/core's migrations and client",
    "# assets from node_modules, which Plug'n'Play doesn't create.",
    "nodeLinker: node-modules",
    "",
  ].join("\n");
}

/**
 * Render a GitHub Actions step as the lines of a YAML list item.
 *
 * @param step - the step to render
 * @param indent - indentation of the list item's dash
 * @returns the step's lines, starting with its comment, if any
 * @example
 * renderWorkflowStep({ name: "Setup pnpm", uses: "pnpm/action-setup@v6" }, "  ");
 * // ["  - name: Setup pnpm", "    uses: pnpm/action-setup@v6"]
 */
function renderWorkflowStep(step: WorkflowStep, indent: string): string[] {
  return [
    ...(step.comment ?? []).map((line) => `${indent}# ${line}`),
    `${indent}- name: ${step.name}`,
    "uses" in step
      ? `${indent}  uses: ${step.uses}`
      : `${indent}  run: ${step.run}`,
  ];
}

/**
 * Rewrite the npm install steps of sites/demo's deploy workflow for another
 * package manager. Every pattern has to match, so a template change that
 * breaks one fails the scaffold instead of shipping a workflow that installs
 * with the wrong manager.
 *
 * @param workflow - content of the template's `.github/workflows/deploy.yml`
 * @param target - package manager the project was scaffolded with
 * @returns the workflow with setup, cache, install, and wrangler steps for
 *   `target`
 * @example
 * adaptDeployWorkflow("      run: npm ci\n...", "pnpm");
 * // "      run: pnpm install --frozen-lockfile\n..."
 */
function adaptDeployWorkflow(
  workflow: string,
  target: DeployWorkflowTarget,
): string {
  const { label, setupStep, cache, install, exec } =
    DEPLOY_WORKFLOW_INSTALL[target];

  // Each pattern captures one group, which `replacement` receives.
  const replaceRequired = (
    content: string,
    pattern: RegExp,
    replacement: (group: string) => string,
  ): string => {
    let matched = false;
    const result = content.replace(pattern, (_, group: string) => {
      matched = true;
      return replacement(group);
    });
    if (!matched) {
      throw new Error(
        `The template's deploy workflow has no match for ${pattern}, so create-jant can't adapt it for ${label}.`,
      );
    }
    return result;
  };

  let result = workflow;
  if (setupStep) {
    result = replaceRequired(
      result,
      /^( *)- name: Setup Node\.js$/m,
      (indent) =>
        [
          ...renderWorkflowStep(setupStep, indent),
          "",
          `${indent}- name: Setup Node.js`,
        ].join("\n"),
    );
  }
  result = replaceRequired(
    result,
    /^( *)cache: npm$/m,
    (indent) => `${indent}cache: ${cache}`,
  );
  result = replaceRequired(
    result,
    /^( *)run: npm ci$/m,
    (indent) => `${indent}run: ${install}`,
  );
  return replaceRequired(
    result,
    /\bnpx (wrangler)\b/g,
    (bin) => `${exec} ${bin}`,
  );
}

/**
 * Format a run command for the given package manager.
 * npm needs `run` for custom scripts, pnpm/yarn do not.
 */
function formatRunCmd(pm: PackageManager, script: string): string {
  return pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
}

/**
 * Execute a shell command silently, returning success/failure.
 */
function runCommand(cmd: string, cwd: string): boolean {
  try {
    execSync(cmd, { stdio: "ignore", cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Process `@create-jant` annotations in a file.
 *
 * Supported annotations (in TOML comments):
 * - `# @create-jant: @remove`           — remove the entire line
 * - `# @create-jant: @remove-start/end` — remove a block of lines
 * - `# @create-jant: "value"`           — replace the quoted value on this line
 * - `# @create-jant: "${name}"`         — replace with interpolated variable
 *
 * @param content - file content to process
 * @param vars - variables for interpolation (e.g. `{ name: "my-site" }`)
 * @returns processed content with annotations applied and removed
 */
function processAnnotations(
  content: string,
  vars: Record<string, string>,
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let removing = false;

  for (const line of lines) {
    if (line.trim() === "# @create-jant: @remove-start") {
      removing = true;
      continue;
    }
    if (line.trim() === "# @create-jant: @remove-end") {
      removing = false;
      continue;
    }
    if (removing) continue;

    if (line.includes("# @create-jant: @remove")) {
      continue;
    }

    // Inline value replacement: key = "old" # @create-jant: "new"
    const replaceMatch = line.match(/^(.+?)\s*#\s*@create-jant:\s*"(.*)"$/);
    if (replaceMatch?.[1] != null && replaceMatch[2] != null) {
      const prefix = replaceMatch[1];
      const newValue = replaceMatch[2];
      const interpolated = newValue.replace(
        /\$\{(\w+)\}/g,
        (_, key: string) => vars[key] ?? "",
      );
      const valueMatch = prefix.match(/^(\s*\S+\s*=\s*)"[^"]*"(.*)$/);
      if (valueMatch) {
        result.push(`${valueMatch[1]}"${interpolated}"${valueMatch[2]}`);
      } else {
        result.push(prefix);
      }
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Copy template files to target directory
 */
async function copyTemplate(config: ProjectConfig): Promise<void> {
  const { projectName, targetDir, packageManager } = config;
  const yarnBerry = isYarnBerry(packageManager);

  // Copy template files from sites/demo (filtered to exclude dev artifacts)
  await fs.copy(TEMPLATE_DIR, targetDir, {
    filter: (src) => {
      const basename = path.basename(src);
      const relativePath = path.relative(TEMPLATE_DIR, src);
      if (basename === "node_modules") return false;
      if (basename === ".wrangler") return false;
      if (basename === ".dev.vars") return false;
      if (basename === ".claude") return false;
      if (basename === "CLAUDE.md") return false;
      if (
        relativePath === path.join("docs", "internal") ||
        relativePath.startsWith(path.join("docs", "internal") + path.sep)
      ) {
        return false;
      }
      return true;
    },
  });

  // Rename underscore-prefixed dotfiles (npm renames .gitignore → .npmignore
  // in published packages, so the template stores them as _gitignore/_github)
  const renames: Array<[string, string]> = [
    ["_gitignore", ".gitignore"],
    ["_github", ".github"],
  ];
  for (const [from, to] of renames) {
    const fromPath = path.join(targetDir, from);
    const toPath = path.join(targetDir, to);
    if (await fs.pathExists(fromPath)) {
      await fs.rename(fromPath, toPath);
    }
  }

  // The template's deploy workflow installs with npm, which needs
  // package-lock.json: `cache: npm` fails without a lock file it recognizes,
  // and `npm ci` fails without package-lock.json. A pnpm or yarn project has
  // only its own lock file, so its workflow installs with that manager.
  const workflowTarget = deployWorkflowTarget(packageManager);
  const workflowPath = path.join(targetDir, ".github/workflows/deploy.yml");
  if (workflowTarget && (await fs.pathExists(workflowPath))) {
    const workflow = await fs.readFile(workflowPath, "utf-8");
    await fs.writeFile(
      workflowPath,
      adaptDeployWorkflow(workflow, workflowTarget),
      "utf-8",
    );
  }

  // Update package.json with project name and fix dependencies
  const pkgPath = path.join(targetDir, "package.json");
  if (await fs.pathExists(pkgPath)) {
    const pkg = await fs.readJson(pkgPath);
    pkg.name = projectName;
    // Replace workspace:* with version injected at build time
    if (pkg.dependencies?.["@jant/core"] === "workspace:*") {
      pkg.dependencies["@jant/core"] = `^${CORE_VERSION}`;
    }
    if (pkg.devDependencies?.wrangler === "catalog:") {
      pkg.devDependencies.wrangler = WRANGLER_VERSION;
    }

    if (packageManager.name === "pnpm" || yarnBerry) {
      // Pin the manager that scaffolded the project, so every machine and CI
      // run installs with the version whose settings pnpm-workspace.yaml or
      // .yarnrc.yml are written for, instead of whatever it happens to find.
      // For Yarn 2+, the pin is also what gets Corepack to install the project
      // instead of the Yarn 1 on PATH, which refuses it.
      if (packageManager.version) {
        pkg.packageManager = `${packageManager.name}@${packageManager.version}`;
      }
    } else {
      delete pkg.packageManager;
    }

    if (packageManager.name !== "pnpm") {
      // Adapt scripts for the detected package manager
      for (const [key, value] of Object.entries(pkg.scripts ?? {})) {
        if (typeof value === "string") {
          pkg.scripts[key] = value.replace(
            /pnpm run (\S+)/g,
            (_, script: string) => formatRunCmd(packageManager.name, script),
          );
        }
      }
    }

    // Yarn 2+ reads build approvals from the root manifest only
    if (yarnBerry) {
      pkg.dependenciesMeta = Object.fromEntries(
        ALLOWED_BUILDS.map((name) => [name, { built: true }]),
      );
    }
    await fs.writeJson(pkgPath, pkg, { spaces: 2 });
  }

  // pnpm reads build approvals from pnpm-workspace.yaml. The file can't live in
  // sites/demo: pnpm takes the nearest one as the workspace root, which would
  // cut the demo off from the monorepo's `workspace:*` packages.
  if (packageManager.name === "pnpm") {
    await fs.writeFile(
      path.join(targetDir, "pnpm-workspace.yaml"),
      renderPnpmWorkspace(),
      "utf-8",
    );
  }

  // Yarn 2+ reads its settings from .yarnrc.yml. The empty yarn.lock makes
  // the project its own root: Yarn refuses to install a project inside
  // another Yarn project's directory unless it has a lock file of its own.
  if (yarnBerry) {
    await fs.writeFile(
      path.join(targetDir, ".yarnrc.yml"),
      renderYarnrc(),
      "utf-8",
    );
    await fs.writeFile(path.join(targetDir, "yarn.lock"), "", "utf-8");
    const gitignorePath = path.join(targetDir, ".gitignore");
    if (await fs.pathExists(gitignorePath)) {
      await fs.appendFile(
        gitignorePath,
        YARN_BERRY_GITIGNORE.map((entry) => `${entry}\n`).join(""),
        "utf-8",
      );
    }
  }

  // Process @create-jant annotations in wrangler.toml
  const wranglerPath = path.join(targetDir, "wrangler.toml");
  if (await fs.pathExists(wranglerPath)) {
    let content = await fs.readFile(wranglerPath, "utf-8");
    content = processAnnotations(content, { name: projectName });

    // S3 storage configuration
    if (config.s3) {
      // Remove [[r2_buckets]] section
      content = content.replace(/\n\[\[r2_buckets\]\][^[]*/s, "\n");
    }

    await fs.writeFile(wranglerPath, content, "utf-8");
  }

  // Generate .dev.vars with a secure AUTH_SECRET
  const authSecret = generateAuthSecret();
  let devVarsContent = `# Generated by create-jant
# AUTH_SECRET is used for session encryption (better-auth)
AUTH_SECRET=${authSecret}
`;

  // S3 storage configuration
  if (config.s3) {
    devVarsContent += `
# S3-compatible storage credentials
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
`;
  }

  await fs.writeFile(
    path.join(targetDir, ".dev.vars"),
    devVarsContent,
    "utf-8",
  );

  // Claude-compatible agent files are generated from the canonical site files
  // so published templates do not depend on symlink behavior.
  const agentsPath = path.join(targetDir, "AGENTS.md");
  if (await fs.pathExists(agentsPath)) {
    await fs.writeFile(
      path.join(targetDir, "CLAUDE.md"),
      "@AGENTS.md\n",
      "utf-8",
    );
  }

  const sourceSkillsDir = path.join(targetDir, ".agents", "skills");
  if (await fs.pathExists(sourceSkillsDir)) {
    await fs.copy(sourceSkillsDir, path.join(targetDir, ".claude", "skills"));
  }
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  console.log(); // eslint-disable-line no-console
  p.intro(chalk.bgCyan.black(" create-jant "));

  program
    .name("create-jant")
    .description("Create a new Jant project")
    .argument("[project-name]", "Name of the project")
    .option("-y, --yes", "Skip prompts and use defaults")
    .option("--s3", "Use S3-compatible storage instead of Cloudflare R2")
    .option("--no-install", "Skip dependency installation")
    .option("--no-git", "Skip git initialization")
    .parse();

  const args = program.args;
  const opts = program.opts<{
    yes?: boolean;
    s3?: boolean;
    install: boolean;
    git: boolean;
  }>();

  let projectName: string;

  // Get project name from argument or prompt
  if (args[0]) {
    projectName = args[0];
  } else if (opts.yes) {
    projectName = "my-jant-site";
  } else {
    const result = await p.text({
      message: "What is your project name?",
      placeholder: "my-jant-site",
      defaultValue: "my-jant-site",
      validate: (value) => {
        if (!value) return "Project name is required";
        const sanitized = toValidProjectName(value);
        if (!isValidProjectName(sanitized)) {
          return "Project name must be lowercase alphanumeric with hyphens";
        }
        return undefined;
      },
    });

    if (p.isCancel(result)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    projectName = result as string;
  }

  // Sanitize project name
  if (!isValidProjectName(projectName)) {
    const sanitized = toValidProjectName(projectName);
    p.log.warn(
      `Project name sanitized: ${chalk.yellow(projectName)} -> ${chalk.green(sanitized)}`,
    );
    projectName = sanitized;
  }

  const targetDir = path.resolve(process.cwd(), projectName);

  // Check if directory already exists
  if (await fs.pathExists(targetDir)) {
    const files = await fs.readdir(targetDir);
    if (files.length > 0) {
      if (opts.yes) {
        p.log.error(
          `Directory ${chalk.red(projectName)} already exists and is not empty`,
        );
        process.exit(1);
      }

      const overwrite = await p.confirm({
        message: `Directory ${chalk.yellow(projectName)} already exists and is not empty. Overwrite?`,
        initialValue: false,
      });

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Operation cancelled");
        process.exit(0);
      }

      await fs.emptyDir(targetDir);
    }
  }

  const detectedPackageManager = detectPackageManager();
  const packageManager = detectedPackageManager.name;

  const config: ProjectConfig = {
    projectName,
    targetDir,
    packageManager: detectedPackageManager,
    install: opts.install,
    git: opts.git,
    s3: opts.s3,
  };

  const spinner = p.spinner();
  spinner.start("Creating project...");

  try {
    await copyTemplate(config);
    spinner.stop("Project created successfully!");
  } catch (error) {
    spinner.stop("Failed to create project");
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Install dependencies
  let installOk = false;
  if (config.install) {
    spinner.start("Installing dependencies...");
    installOk = runCommand(`${packageManager} install`, targetDir);
    if (installOk) {
      // Run install again to stabilize lock file (npm may change peer
      // dependency flags between the first and second resolution pass)
      runCommand(`${packageManager} install`, targetDir);
      spinner.stop("Dependencies installed.");
    } else {
      spinner.stop(
        chalk.yellow(
          `Failed to install dependencies. Run ${chalk.bold(`${packageManager} install`)} manually.`,
        ),
      );
    }
  }

  // Initialize git repository
  if (config.git) {
    spinner.start("Initializing git repository...");
    const gitOk =
      runCommand("git init", targetDir) &&
      runCommand("git add -A", targetDir) &&
      runCommand('git commit -m "Initial commit"', targetDir);
    if (gitOk) {
      spinner.stop("Git repository initialized.");
    } else {
      spinner.stop("Skipped git initialization.");
    }
  }

  // Show next steps
  const steps: string[] = [`cd ${projectName}`];
  if (!config.install || !installOk) {
    steps.push(`${packageManager} install`);
  }
  steps.push(formatRunCmd(packageManager, "dev"));

  console.log(); // eslint-disable-line no-console
  p.note(steps.join("\n"), "Next steps");

  p.outro(chalk.green("Happy coding!"));
}

main().catch((error) => {
  console.error(chalk.red("Error:"), error); // eslint-disable-line no-console
  process.exit(1);
});
