/**
 * Built-in syntax-highlighted code block languages.
 *
 * Kept separate from `highlight-code.ts` so editor UI can list options
 * without eagerly bundling `highlight.js`.
 */

export interface CodeBlockNodeLabels {
  /** Accessible label for the code block language selector. */
  languageLabel: string;
  /** Option label when no syntax language is selected. */
  plainText: string;
}

export const DEFAULT_CODE_BLOCK_NODE_LABELS: CodeBlockNodeLabels = {
  languageLabel: "Code language",
  plainText: "Plain text",
};

export interface CodeBlockLanguageOption {
  /** Value stored in `codeBlock.attrs.language` when chosen from the picker. */
  readonly value: string;
  /** Human-readable language label shown in the editor picker. */
  readonly label: string;
  /** Lowercased language identifiers and aliases that map to this option. */
  readonly aliases: readonly string[];
}

export const CODE_BLOCK_LANGUAGES: readonly CodeBlockLanguageOption[] = [
  { value: "bash", label: "Bash", aliases: ["bash", "sh", "zsh"] },
  { value: "c", label: "C", aliases: ["c", "h"] },
  { value: "csharp", label: "C#", aliases: ["csharp", "cs", "c#"] },
  {
    value: "cpp",
    label: "C++",
    aliases: ["cpp", "cc", "c++", "h++", "hpp", "hh", "hxx", "cxx"],
  },
  { value: "css", label: "CSS", aliases: ["css"] },
  { value: "diff", label: "Diff", aliases: ["diff", "patch"] },
  { value: "go", label: "Go", aliases: ["go", "golang"] },
  {
    value: "html",
    label: "HTML / XML",
    aliases: [
      "html",
      "xml",
      "xhtml",
      "rss",
      "atom",
      "xjb",
      "xsd",
      "xsl",
      "plist",
      "wsf",
      "svg",
    ],
  },
  { value: "java", label: "Java", aliases: ["java", "jsp"] },
  {
    value: "javascript",
    label: "JavaScript",
    aliases: ["javascript", "js", "jsx", "mjs", "cjs"],
  },
  { value: "json", label: "JSON", aliases: ["json", "jsonc"] },
  {
    value: "markdown",
    label: "Markdown",
    aliases: ["markdown", "md", "mkdown", "mkd"],
  },
  { value: "php", label: "PHP", aliases: ["php"] },
  {
    value: "python",
    label: "Python",
    aliases: ["python", "py", "gyp", "ipython"],
  },
  {
    value: "ruby",
    label: "Ruby",
    aliases: ["ruby", "rb", "gemspec", "podspec", "thor", "irb"],
  },
  { value: "rust", label: "Rust", aliases: ["rust", "rs"] },
  { value: "sql", label: "SQL", aliases: ["sql"] },
  { value: "swift", label: "Swift", aliases: ["swift"] },
  {
    value: "typescript",
    label: "TypeScript",
    aliases: ["typescript", "ts", "tsx", "mts", "cts"],
  },
  { value: "yaml", label: "YAML", aliases: ["yaml", "yml"] },
] as const;

const ALIAS_TO_VALUE = new Map<string, string>(
  CODE_BLOCK_LANGUAGES.flatMap((option) =>
    option.aliases.map((alias) => [alias, option.value] as const),
  ),
);

/**
 * Resolve a stored code block language (including aliases like `js` or `py`)
 * to its built-in picker value, or `null` if it is blank or unlisted.
 *
 * @param language - Raw `language` attribute from a code block node
 * @returns Canonical picker option value, or `null` when unlisted/empty
 * @example
 * resolveCodeLanguageOption("js"); // "javascript"
 */
export function resolveCodeLanguageOption(
  language: string | null | undefined,
): string | null {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return null;
  return ALIAS_TO_VALUE.get(normalized) ?? null;
}
