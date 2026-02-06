#!/usr/bin/env node

/**
 * Jant CLI
 *
 * Commands:
 *   swizzle <component> [--wrap|--eject]  - Override a theme component
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Available components that can be swizzled
const SWIZZLABLE_COMPONENTS = {
  PostCard: {
    file: "PostCard.tsx",
    props: "PostCardProps",
  },
  PostList: {
    file: "PostList.tsx",
    props: "PostListProps",
  },
  Pagination: {
    file: "Pagination.tsx",
    props: "PaginationProps",
  },
  EmptyState: {
    file: "EmptyState.tsx",
    props: "EmptyStateProps",
  },
  BaseLayout: {
    file: "BaseLayout.tsx",
    props: "BaseLayoutProps",
    isLayout: true,
  },
};

function showHelp() {
  console.log(`
Jant CLI

Usage:
  jant swizzle <component> [options]

Commands:
  swizzle <component>   Override a theme component

Options:
  --wrap     Create a wrapper around the original component (default)
  --eject    Copy the full component source for complete customization
  --list     List available components

Examples:
  jant swizzle PostCard           # Wrap PostCard component
  jant swizzle PostCard --eject   # Copy PostCard source
  jant swizzle --list             # List all swizzlable components
`);
}

function listComponents() {
  console.log("\nAvailable components to swizzle:\n");
  for (const [name, info] of Object.entries(SWIZZLABLE_COMPONENTS)) {
    const type = info.isLayout ? "[Layout]" : "[Component]";
    console.log(`  ${name.padEnd(15)} ${type}`);
  }
  console.log("\nUsage: jant swizzle <component> [--wrap|--eject]\n");
}

function generateWrapperCode(componentName, info) {
  const importPath = info.isLayout ? "@jant/core/theme/layouts" : "@jant/core/theme/components";

  return `/**
 * Custom ${componentName} component
 *
 * This is a wrapper around the original ${componentName}.
 * You can customize the rendering while keeping the original functionality.
 */

import type { ${info.props} } from "@jant/core";
import { ${componentName} as Original${componentName} } from "${importPath}";

export function ${componentName}(props: ${info.props}) {
  // Add your customizations here
  return (
    <div class="custom-${componentName.toLowerCase()}-wrapper">
      <Original${componentName} {...props} />
    </div>
  );
}
`;
}

function swizzle(componentName, mode) {
  const info = SWIZZLABLE_COMPONENTS[componentName];
  if (!info) {
    console.error(`Error: Unknown component "${componentName}"`);
    console.log("\nAvailable components:");
    listComponents();
    process.exit(1);
  }

  const targetDir = info.isLayout
    ? resolve(process.cwd(), "src/theme/layouts")
    : resolve(process.cwd(), "src/theme/components");

  const targetFile = resolve(targetDir, info.file);

  // Check if file already exists
  if (existsSync(targetFile)) {
    console.error(`Error: ${targetFile} already exists`);
    console.log("Remove it first if you want to re-swizzle.");
    process.exit(1);
  }

  // Create directory if needed
  mkdirSync(targetDir, { recursive: true });

  if (mode === "eject") {
    // For eject mode, we'd need to copy the actual source
    // For now, show a message about where to find it
    console.log(`
To eject ${componentName}, copy the source from:
  node_modules/@jant/core/src/theme/${info.isLayout ? "layouts" : "components"}/${info.file}

Then modify it as needed.
`);
    return;
  }

  // Generate wrapper code
  const code = generateWrapperCode(componentName, info);
  writeFileSync(targetFile, code, "utf-8");

  console.log(`
✓ Created ${targetFile}

Next steps:
1. Customize the component in the generated file
2. Import it in your src/index.ts:

   import { ${componentName} } from "./theme/${info.isLayout ? "layouts" : "components"}/${componentName}";

   export default createApp({
     theme: {
       components: {
         ${componentName},
       },
     },
   });
`);
}

// Parse arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  showHelp();
  process.exit(0);
}

const command = args[0];

if (command === "swizzle") {
  if (args.includes("--list")) {
    listComponents();
    process.exit(0);
  }

  const componentName = args[1];
  if (!componentName) {
    console.error("Error: Component name required");
    console.log("Usage: jant swizzle <component> [--wrap|--eject]");
    process.exit(1);
  }

  const mode = args.includes("--eject") ? "eject" : "wrap";
  swizzle(componentName, mode);
} else {
  console.error(`Unknown command: ${command}`);
  showHelp();
  process.exit(1);
}
