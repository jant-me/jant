import { program } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Template directory resolution:
// - If template/ exists next to dist/ (after prepublish copy), use that
// - Otherwise, use the source templates/jant-site (for local dev)
// From dist/index.js: ../template or ../../../templates/jant-site
const TEMPLATE_DIR = fs.existsSync(path.resolve(__dirname, "../template"))
  ? path.resolve(__dirname, "../template")
  : path.resolve(__dirname, "../../../templates/jant-site");

interface ProjectConfig {
  projectName: string;
  targetDir: string;
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
 * Copy template files to target directory
 */
async function copyTemplate(config: ProjectConfig): Promise<void> {
  const { projectName, targetDir } = config;

  // Copy all template files
  await fs.copy(TEMPLATE_DIR, targetDir, {
    filter: (src) => {
      const basename = path.basename(src);
      // Skip system files and development artifacts
      if (basename.startsWith(".DS_Store")) return false;
      if (basename === "node_modules") return false;
      if (basename === ".wrangler") return false;
      if (basename === ".swc") return false;
      if (basename === ".dev.vars") return false;
      if (basename === "pnpm-lock.yaml") return false;
      if (basename === "dist") return false;
      return true;
    },
  });

  // Rename special files (prefixed with _ to avoid issues)
  const renames: Array<[string, string]> = [
    ["_gitignore", ".gitignore"],
    ["_env.example", ".dev.vars.example"],
  ];

  for (const [from, to] of renames) {
    const fromPath = path.join(targetDir, from);
    const toPath = path.join(targetDir, to);
    if (await fs.pathExists(fromPath)) {
      await fs.rename(fromPath, toPath);
    }
  }

  // Update package.json with project name and fix dependencies
  const pkgPath = path.join(targetDir, "package.json");
  if (await fs.pathExists(pkgPath)) {
    const pkg = await fs.readJson(pkgPath);
    pkg.name = projectName;
    // Replace workspace:* with actual version for npm publishing
    if (pkg.dependencies?.["@jant/core"] === "workspace:*") {
      pkg.dependencies["@jant/core"] = "^0.1.0";
    }
    await fs.writeJson(pkgPath, pkg, { spaces: 2 });
  }

  // Update wrangler.toml with project-specific values
  const wranglerPath = path.join(targetDir, "wrangler.toml");
  if (await fs.pathExists(wranglerPath)) {
    let content = await fs.readFile(wranglerPath, "utf-8");
    content = content.replace(/name = "jant-site"/g, `name = "${projectName}"`);
    content = content.replace(/database_name = "jant-site-db"/g, `database_name = "${projectName}-db"`);
    content = content.replace(/bucket_name = "jant-site-media"/g, `bucket_name = "${projectName}-media"`);
    // Remove [env.demo] section (specific to demo.jant.me, not for user projects)
    content = content.replace(/\n# =+\n# Demo Environment\n# =+\n\[env\.demo\][\s\S]*$/, "\n");
    await fs.writeFile(wranglerPath, content, "utf-8");
  }
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  console.log();
  p.intro(chalk.bgCyan.black(" create-jant "));

  program
    .name("create-jant")
    .description("Create a new Jant project")
    .argument("[project-name]", "Name of the project")
    .option("-y, --yes", "Skip prompts and use defaults")
    .parse();

  const args = program.args;
  const opts = program.opts<{ yes?: boolean }>();

  let projectName: string;

  // Get project name from argument or prompt
  if (args[0]) {
    projectName = args[0];
  } else if (opts.yes) {
    projectName = "jant-site";
  } else {
    const result = await p.text({
      message: "What is your project name?",
      placeholder: "jant-site",
      defaultValue: "jant-site",
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
    p.log.warn(`Project name sanitized: ${chalk.yellow(projectName)} -> ${chalk.green(sanitized)}`);
    projectName = sanitized;
  }

  const targetDir = path.resolve(process.cwd(), projectName);

  // Check if directory already exists
  if (await fs.pathExists(targetDir)) {
    const files = await fs.readdir(targetDir);
    if (files.length > 0) {
      if (opts.yes) {
        p.log.error(`Directory ${chalk.red(projectName)} already exists and is not empty`);
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

  const config: ProjectConfig = {
    projectName,
    targetDir,
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

  // Show next steps
  console.log();
  p.note(
    [
      `cd ${projectName}`,
      "pnpm install",
      "cp .dev.vars.example .dev.vars",
      "# Edit .dev.vars with your AUTH_SECRET",
      "pnpm dev",
    ].join("\n"),
    "Next steps"
  );

  p.outro(chalk.green("Happy coding!"));
}

main().catch((error) => {
  console.error(chalk.red("Error:"), error);
  process.exit(1);
});
