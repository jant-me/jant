import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { encodeIco, FAVICON_SIZES } from "../../src/lib/favicon.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "../..");
const sourceSvgPath = resolve(
  packageRoot,
  "src/assets/branding/jant-logo-positive.svg",
);
const outputPath = resolve(packageRoot, "src/lib/jant-branding-generated.ts");
const DEFAULT_EXPORT_DIR = "packages/core/src/assets/branding/generated";
const EXPORTED_ASSET_FILENAMES = {
  positiveLogoSvg: "jant-logo-positive.svg",
  negativeLogoSvg: "jant-logo-negative.svg",
  positiveLogoPng: "jant-logo-positive-512.png",
  brandTileSvg: "jant-brand-tile.svg",
  brandTilePng: "jant-brand-tile-512.png",
  squareTileSvg: "jant-square-tile.svg",
  squareTilePng: "jant-square-tile-512.png",
  circleTileSvg: "jant-circle-tile.svg",
  circleTilePng: "jant-circle-tile-512.png",
  favicon: "jant-favicon.ico",
  appleTouch: "jant-apple-touch-icon.png",
  socialImage: "jant-social-preview.png",
  brandPack: "jant-brand-assets.zip",
} as const;

const NEGATIVE_FILL = "#FFFFFF";
const APP_ICON_CORNER_RADIUS = 22;
const SQUARE_TILE_CORNER_RADIUS = 0;
const POSITIVE_PNG_SIZE = 512;
const BRAND_TILE_PNG_SIZE = 512;
const SQUARE_TILE_PNG_SIZE = 512;
const CIRCLE_TILE_PNG_SIZE = 512;
const SOCIAL_IMAGE_SIZE = 512;

interface BrandAssetBundle {
  positiveFill: string;
  positiveSvg: string;
  negativeSvg: string;
  roundedTileSvg: string;
  squareTileSvg: string;
  circleTileSvg: string;
  brandTilePng: ArrayBuffer;
  squareTilePng: ArrayBuffer;
  circleTilePng: ArrayBuffer;
  positiveLogoPng: ArrayBuffer;
  faviconIco: ArrayBuffer;
  appleTouchPng: ArrayBuffer;
  socialImagePng: ArrayBuffer;
}

function fail(message: string): never {
  throw new Error(message);
}

function normalizeSvg(svg: string): string {
  return svg.replace(/\r\n?/g, "\n").replace(/>\s+</g, "><").trim();
}

function extractSvgAttribute(svg: string, attribute: string): string {
  const match = svg.match(new RegExp(`${attribute}="([^"]+)"`));
  if (!match?.[1]) {
    fail(`Missing required SVG attribute: ${attribute}`);
  }

  return match[1];
}

function extractPathData(svg: string): string {
  const match = svg.match(/<path\b[^>]*\bd="([^"]+)"/);
  if (!match?.[1]) {
    fail('Missing required <path d="..."> in source SVG');
  }

  return match[1];
}

function extractFill(svg: string): string {
  const match = svg.match(/<path\b[^>]*\bfill="([^"]+)"/i);
  if (!match?.[1]) {
    fail("Missing required path fill in source SVG");
  }

  return match[1];
}

function buildLogoSvgMarkup({
  viewBox,
  pathData,
  fill,
}: {
  viewBox: string;
  pathData: string;
  fill: string;
}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><path fill="${fill}" d="${pathData}"/></svg>`;
}

function buildAppIconSvgMarkup({
  viewBox,
  pathData,
  backgroundFill,
  markFill,
  cornerRadius,
}: {
  viewBox: string;
  pathData: string;
  backgroundFill: string;
  markFill: string;
  cornerRadius: number;
}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><rect width="100" height="100" rx="${cornerRadius}" fill="${backgroundFill}"/><path fill="${markFill}" d="${pathData}"/></svg>`;
}

function buildCircleTileSvgMarkup({
  viewBox,
  pathData,
  backgroundFill,
  markFill,
}: {
  viewBox: string;
  pathData: string;
  backgroundFill: string;
  markFill: string;
}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><circle cx="50" cy="50" r="50" fill="${backgroundFill}"/><path fill="${markFill}" d="${pathData}"/></svg>`;
}

async function rasterizeSvg(svg: string, size: number): Promise<ArrayBuffer> {
  const rendered = await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toBuffer();

  // Copied into an ArrayBuffer of its own: a Buffer can be a view into a larger
  // pooled store.
  return new Uint8Array(rendered).buffer;
}

function toBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

function chunkBase64(base64: string): string[] {
  return base64.match(/.{1,120}/g) ?? [];
}

function formatStringExport(name: string, value: string): string {
  return `export const ${name} = ${JSON.stringify(value)};\n`;
}

function formatNumberExport(name: string, value: number): string {
  return `export const ${name} = ${value};\n`;
}

function formatBase64Export(name: string, value: string): string {
  const chunks = chunkBase64(value)
    .map((chunk) => `  ${JSON.stringify(chunk)},`)
    .join("\n");

  return `export const ${name} = [\n${chunks}\n].join("");\n`;
}

function buildBrandPackReadme(): string {
  return [
    "Jant Brand Assets",
    "",
    "Included files:",
    `- ${EXPORTED_ASSET_FILENAMES.positiveLogoSvg}`,
    `- ${EXPORTED_ASSET_FILENAMES.negativeLogoSvg}`,
    `- ${EXPORTED_ASSET_FILENAMES.positiveLogoPng}`,
    `- ${EXPORTED_ASSET_FILENAMES.brandTileSvg}`,
    `- ${EXPORTED_ASSET_FILENAMES.brandTilePng}`,
    `- ${EXPORTED_ASSET_FILENAMES.squareTileSvg}`,
    `- ${EXPORTED_ASSET_FILENAMES.squareTilePng}`,
    `- ${EXPORTED_ASSET_FILENAMES.circleTileSvg}`,
    `- ${EXPORTED_ASSET_FILENAMES.circleTilePng}`,
    `- ${EXPORTED_ASSET_FILENAMES.favicon}`,
    `- ${EXPORTED_ASSET_FILENAMES.appleTouch}`,
    `- ${EXPORTED_ASSET_FILENAMES.socialImage}`,
  ].join("\n");
}

function printHelp(): void {
  console.log(`Usage: node dev/run-script.mjs dev/scripts/generate-brand-assets.ts [options]

Options:
  --export-dir <path>  Write generated logo/icon assets to a local directory
  --export-only        Skip updating src/lib/jant-branding-generated.ts
  --help               Show this help message

Examples:
  node dev/run-script.mjs dev/scripts/generate-brand-assets.ts
  node dev/run-script.mjs dev/scripts/generate-brand-assets.ts --export-dir ${DEFAULT_EXPORT_DIR} --export-only`);
}

async function buildAssetBundle({
  viewBox,
  pathData,
  positiveFill,
}: {
  viewBox: string;
  pathData: string;
  positiveFill: string;
}): Promise<BrandAssetBundle> {
  const positiveSvg = buildLogoSvgMarkup({
    viewBox,
    pathData,
    fill: positiveFill,
  });
  const negativeSvg = buildLogoSvgMarkup({
    viewBox,
    pathData,
    fill: NEGATIVE_FILL,
  });
  const roundedTileSvg = buildAppIconSvgMarkup({
    viewBox,
    pathData,
    backgroundFill: positiveFill,
    markFill: NEGATIVE_FILL,
    cornerRadius: APP_ICON_CORNER_RADIUS,
  });
  const squareTileSvg = buildAppIconSvgMarkup({
    viewBox,
    pathData,
    backgroundFill: positiveFill,
    markFill: NEGATIVE_FILL,
    cornerRadius: SQUARE_TILE_CORNER_RADIUS,
  });
  const circleTileSvg = buildCircleTileSvgMarkup({
    viewBox,
    pathData,
    backgroundFill: positiveFill,
    markFill: NEGATIVE_FILL,
  });

  const positiveLogoPng = await rasterizeSvg(positiveSvg, POSITIVE_PNG_SIZE);
  const brandTilePng = await rasterizeSvg(roundedTileSvg, BRAND_TILE_PNG_SIZE);
  const squareTilePng = await rasterizeSvg(squareTileSvg, SQUARE_TILE_PNG_SIZE);
  const circleTilePng = await rasterizeSvg(circleTileSvg, CIRCLE_TILE_PNG_SIZE);
  const favicon16 = await rasterizeSvg(roundedTileSvg, FAVICON_SIZES.ICO_16);
  const favicon32 = await rasterizeSvg(roundedTileSvg, FAVICON_SIZES.ICO_32);
  const appleTouchPng = await rasterizeSvg(
    roundedTileSvg,
    FAVICON_SIZES.APPLE_TOUCH,
  );
  const socialImagePng = await rasterizeSvg(roundedTileSvg, SOCIAL_IMAGE_SIZE);
  const faviconIco = await encodeIco([
    { size: FAVICON_SIZES.ICO_16, png: favicon16 },
    { size: FAVICON_SIZES.ICO_32, png: favicon32 },
  ]).arrayBuffer();

  return {
    positiveFill,
    positiveSvg,
    negativeSvg,
    roundedTileSvg,
    squareTileSvg,
    circleTileSvg,
    brandTilePng,
    squareTilePng,
    circleTilePng,
    positiveLogoPng,
    faviconIco,
    appleTouchPng,
    socialImagePng,
  };
}

async function writeAssetFile(
  filePath: string,
  content: string | ArrayBuffer,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  if (typeof content === "string") {
    await writeFile(filePath, content, "utf8");
    return;
  }

  await writeFile(filePath, Buffer.from(content));
}

async function exportBrandAssets(
  exportDir: string,
  bundle: BrandAssetBundle,
): Promise<void> {
  const resolvedExportDir = resolve(process.cwd(), exportDir);
  const files: Array<[string, string | ArrayBuffer]> = [
    [EXPORTED_ASSET_FILENAMES.positiveLogoSvg, bundle.positiveSvg],
    [EXPORTED_ASSET_FILENAMES.negativeLogoSvg, bundle.negativeSvg],
    [EXPORTED_ASSET_FILENAMES.positiveLogoPng, bundle.positiveLogoPng],
    [EXPORTED_ASSET_FILENAMES.brandTileSvg, bundle.roundedTileSvg],
    [EXPORTED_ASSET_FILENAMES.brandTilePng, bundle.brandTilePng],
    [EXPORTED_ASSET_FILENAMES.squareTileSvg, bundle.squareTileSvg],
    [EXPORTED_ASSET_FILENAMES.squareTilePng, bundle.squareTilePng],
    [EXPORTED_ASSET_FILENAMES.circleTileSvg, bundle.circleTileSvg],
    [EXPORTED_ASSET_FILENAMES.circleTilePng, bundle.circleTilePng],
    [EXPORTED_ASSET_FILENAMES.favicon, bundle.faviconIco],
    [EXPORTED_ASSET_FILENAMES.appleTouch, bundle.appleTouchPng],
    [EXPORTED_ASSET_FILENAMES.socialImage, bundle.socialImagePng],
  ];
  const archive = zipSync(
    Object.fromEntries(
      files.map(([filename, content]) => [
        filename,
        typeof content === "string"
          ? strToU8(content)
          : new Uint8Array(content),
      ]),
    ),
    { level: 0 },
  );

  for (const [filename, content] of files) {
    await writeAssetFile(resolve(resolvedExportDir, filename), content);
  }

  await writeAssetFile(
    resolve(resolvedExportDir, EXPORTED_ASSET_FILENAMES.brandPack),
    archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength,
    ),
  );
  await writeAssetFile(
    resolve(resolvedExportDir, "README.txt"),
    buildBrandPackReadme(),
  );

  console.log(`Exported brand assets to ${resolvedExportDir}`);
}

async function writeGeneratedModule({
  viewBox,
  pathData,
  defaultBundle,
}: {
  viewBox: string;
  pathData: string;
  defaultBundle: BrandAssetBundle;
}): Promise<void> {
  const file = `// Generated by dev/scripts/generate-brand-assets.ts.
// Do not edit this file directly.

${formatStringExport("JANT_LOGO_VIEW_BOX", viewBox)}${formatStringExport(
    "JANT_LOGO_PATH_DATA",
    pathData,
  )}${formatStringExport(
    "JANT_LOGO_POSITIVE_FILL",
    defaultBundle.positiveFill,
  )}${formatStringExport(
    "JANT_LOGO_NEGATIVE_FILL",
    NEGATIVE_FILL,
  )}${formatNumberExport(
    "JANT_APP_ICON_CORNER_RADIUS",
    APP_ICON_CORNER_RADIUS,
  )}${formatStringExport(
    "JANT_LOGO_POSITIVE_SVG",
    defaultBundle.positiveSvg,
  )}${formatStringExport(
    "JANT_LOGO_NEGATIVE_SVG",
    defaultBundle.negativeSvg,
  )}${formatStringExport(
    "JANT_APP_ICON_SVG",
    defaultBundle.roundedTileSvg,
  )}${formatStringExport(
    "JANT_SQUARE_TILE_SVG",
    defaultBundle.squareTileSvg,
  )}${formatStringExport(
    "JANT_CIRCLE_TILE_SVG",
    defaultBundle.circleTileSvg,
  )}${formatBase64Export(
    "JANT_BRAND_TILE_512_PNG_BASE64",
    toBase64(defaultBundle.brandTilePng),
  )}${formatBase64Export(
    "JANT_SQUARE_TILE_512_PNG_BASE64",
    toBase64(defaultBundle.squareTilePng),
  )}${formatBase64Export(
    "JANT_CIRCLE_TILE_512_PNG_BASE64",
    toBase64(defaultBundle.circleTilePng),
  )}${formatBase64Export(
    "JANT_DEFAULT_FAVICON_ICO_BASE64",
    toBase64(defaultBundle.faviconIco),
  )}${formatBase64Export(
    "JANT_DEFAULT_APPLE_TOUCH_ICON_PNG_BASE64",
    toBase64(defaultBundle.appleTouchPng),
  )}${formatBase64Export(
    "JANT_DEFAULT_SOCIAL_IMAGE_PNG_BASE64",
    toBase64(defaultBundle.socialImagePng),
  )}${formatBase64Export(
    "JANT_LOGO_POSITIVE_512_PNG_BASE64",
    toBase64(defaultBundle.positiveLogoPng),
  )}`;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, file);
  console.log(`Generated ${outputPath}`);
}

export default async function main(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      "export-dir": { type: "string" },
      "export-only": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const exportDir = values["export-dir"];
  if (exportDir === "") {
    fail("Missing value for --export-dir");
  }

  const sourceSvg = normalizeSvg(await readFile(sourceSvgPath, "utf8"));
  const viewBox = extractSvgAttribute(sourceSvg, "viewBox");
  const pathData = extractPathData(sourceSvg);
  const defaultBundle = await buildAssetBundle({
    viewBox,
    pathData,
    positiveFill: extractFill(sourceSvg),
  });

  if (exportDir) {
    await exportBrandAssets(exportDir, defaultBundle);
  }

  if (!values["export-only"]) {
    await writeGeneratedModule({ viewBox, pathData, defaultBundle });
  }
}
