import { z } from "zod";
import { CODE_THEMES, CONFIG_FIELDS, type CodeTheme } from "../types/config.js";

export const codeThemeSchema = z.enum(CODE_THEMES);

/**
 * Resolve a stored code theme, falling back when absent or unrecognized.
 *
 * @param value - Site setting from the database
 * @returns A built-in code theme ID
 * @example
 * resolveCodeTheme(undefined); // "github"
 */
export function resolveCodeTheme(value: string | undefined): CodeTheme {
  return (
    codeThemeSchema.safeParse(value).data ??
    CONFIG_FIELDS.CODE_THEME.defaultValue
  );
}
