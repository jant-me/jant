/**
 * Lucide icons for server-rendered UI.
 *
 * Every icon the server draws is imported here by name and listed in
 * `LUCIDE_ICONS`, so the build keeps these few and drops the rest of the
 * 1,700-icon `lucide-static` set, and an unknown or misspelled name fails the
 * type check instead of rendering nothing. To use another icon, import it and
 * add it under its Lucide name (lucide.dev).
 */

import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  ChevronDown,
  Clock,
  ExternalLink,
  EyeOff,
  File as FileIcon,
  FileText,
  Funnel,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  History as HistoryIcon,
  Image as ImageIcon,
  LayoutGrid,
  List,
  ListTree,
  Lock as LockIcon,
  Monitor,
  Music,
  NotepadText,
  Pencil,
  Play,
  Plus,
  Quote,
  Rss,
  ScanEye,
  Shapes,
  TextAlignStart,
  Trash2,
  Type,
  Video,
  X,
} from "lucide-static";

const LUCIDE_ICONS = {
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  calendar: Calendar,
  "chevron-down": ChevronDown,
  clock: Clock,
  "external-link": ExternalLink,
  "eye-off": EyeOff,
  file: FileIcon,
  "file-text": FileText,
  funnel: Funnel,
  "git-branch": GitBranch,
  "git-commit-horizontal": GitCommitHorizontal,
  globe: Globe,
  history: HistoryIcon,
  image: ImageIcon,
  "layout-grid": LayoutGrid,
  list: List,
  "list-tree": ListTree,
  lock: LockIcon,
  monitor: Monitor,
  music: Music,
  "notepad-text": NotepadText,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  quote: Quote,
  rss: Rss,
  "scan-eye": ScanEye,
  shapes: Shapes,
  "text-align-start": TextAlignStart,
  "trash-2": Trash2,
  type: Type,
  video: Video,
  x: X,
} as const satisfies Record<string, string>;

/** Kebab-case name of a Lucide icon the server renders. */
export type LucideIconName = keyof typeof LUCIDE_ICONS;

/** Every name in `LUCIDE_ICONS`. */
export const LUCIDE_ICON_NAMES = Object.keys(LUCIDE_ICONS) as LucideIconName[];

/**
 * Get SVG markup for a Lucide icon.
 *
 * @param name - Kebab-case Lucide icon name
 * @param className - Extra classes for the `<svg>`, appended to Lucide's own.
 *   `icon-fine` is the project's lighter stroke.
 * @returns The `<svg>` element as a string
 *
 * @example
 * ```ts
 * getIconSvg("rss");
 * getIconSvg("funnel", "icon-fine");
 * ```
 */
export function getIconSvg(name: LucideIconName, className?: string): string {
  const svg = LUCIDE_ICONS[name];
  if (!className) return svg;
  // Lucide always ships a `class="lucide lucide-…"`, so extend it rather than
  // adding a second class attribute the parser would drop.
  return svg.replace(/class="([^"]*)"/, `class="$1 ${className}"`);
}

/**
 * Get the inner SVG contents for a Lucide icon (the path children only,
 * without the outer <svg> wrapper). Used by the icon sprite to build
 * <symbol> definitions.
 *
 * @param name - Kebab-case Lucide icon name
 * @returns Inner SVG markup (e.g. "<path ... />")
 *
 * @example
 * ```ts
 * getIconInnerSvg("pencil");
 * // -> "<path d=\"...\"/><path d=\"...\"/>"
 * ```
 */
export function getIconInnerSvg(name: LucideIconName): string {
  const svg = LUCIDE_ICONS[name];
  // lucide-static output looks like:
  //   <svg ... viewBox="0 0 24 24" ...><path .../>...<line .../></svg>
  // Strip the outer <svg ...> and </svg>.
  return svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));
}

/**
 * Default stroke/fill attributes inherited by <symbol> children when a
 * lucide icon is referenced via <use>. These mirror the attributes lucide
 * normally sets on the outer <svg> so the currentColor-based theming keeps
 * working through <use>.
 */
export const LUCIDE_SYMBOL_ATTRS =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const LUCIDE_VIEWBOX = "0 0 24 24";
