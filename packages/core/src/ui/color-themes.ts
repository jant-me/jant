/**
 * Built-in Color Themes
 *
 * Each theme defines CSS variable overrides for light and dark modes.
 */

/**
 * A color theme definition with light and dark mode CSS variable overrides.
 */
export interface ColorTheme {
  /** Stored in DB settings, e.g. "linen" */
  id: string;
  /** Display name, e.g. "Dune" */
  name: string;
  /** CSS variable overrides for :root (light mode) */
  light: Record<string, string>;
  /** CSS variable overrides for dark mode */
  dark: Record<string, string>;
}

interface ThemeModeColors {
  bg: string;
  fg: string;
  primary: string;
  primaryFg: string;
  siteAccent: string;
  muted: string;
  mutedFg: string;
  border: string;
  /** Destructive action color (defaults to BaseCoat red) */
  destructive?: string;
  /** Success indicator color (defaults to preset green) */
  success?: string;
  /** Search highlight background */
  searchMarkBg?: string;
  /** Search highlight text color */
  searchMarkColor?: string;
  /** Settings page background */
  dashBg?: string;
  /** Detail-page title color for long-form reading */
  readingTitle?: string;
  /** Detail-page heading color for long-form reading */
  readingHeading?: string;
  /** Detail-page body color for long-form reading */
  readingBody?: string;
  /** Detail-page quote color for long-form reading */
  readingQuote?: string;
}

/** Default destructive/success colors that harmonize with most themes */
const DEFAULTS = {
  light: {
    destructive: "oklch(0.577 0.245 27.325)",
    success: "oklch(0.518 0.16 145.071)",
    searchMarkBg: "oklch(0.92 0.14 90 / 0.55)",
    searchMarkColor: "oklch(0.35 0.09 70)",
    dashBg: "oklch(0.97 0.005 80)",
  },
  dark: {
    destructive: "oklch(0.704 0.191 22.216)",
    success: "oklch(0.627 0.194 149.214)",
    searchMarkBg: "oklch(0.45 0.1 85 / 0.5)",
    searchMarkColor: "oklch(0.92 0.08 90)",
    dashBg: "oklch(0.2 0.005 80)",
  },
};

/**
 * Create a comprehensive color theme from key colors.
 * Derives card, popover, muted, secondary, accent, and sidebar variables.
 * Also sets --destructive, --success, --search-mark-*, and --dash-bg.
 */
function defineTheme(opts: {
  id: string;
  name: string;
  light: ThemeModeColors;
  dark: ThemeModeColors;
}): ColorTheme {
  const { light, dark } = opts;
  return {
    id: opts.id,
    name: opts.name,
    light: {
      "--background": light.bg,
      "--foreground": light.fg,
      "--card": light.bg,
      "--card-foreground": light.fg,
      "--popover": light.bg,
      "--popover-foreground": light.fg,
      "--primary": light.primary,
      "--primary-foreground": light.primaryFg,
      "--site-accent": light.siteAccent,
      "--secondary": light.muted,
      "--secondary-foreground": light.fg,
      "--muted": light.muted,
      "--muted-foreground": light.mutedFg,
      "--accent": light.muted,
      "--accent-foreground": light.fg,
      "--destructive": light.destructive ?? DEFAULTS.light.destructive,
      "--success": light.success ?? DEFAULTS.light.success,
      "--border": light.border,
      "--input": light.border,
      "--ring": light.primary,
      "--sidebar": light.bg,
      "--sidebar-foreground": light.fg,
      "--sidebar-primary": light.primary,
      "--sidebar-primary-foreground": light.primaryFg,
      "--sidebar-accent": light.muted,
      "--sidebar-accent-foreground": light.fg,
      "--sidebar-border": light.border,
      "--sidebar-ring": light.primary,
      "--search-mark-bg": light.searchMarkBg ?? DEFAULTS.light.searchMarkBg,
      "--search-mark-color":
        light.searchMarkColor ?? DEFAULTS.light.searchMarkColor,
      "--dash-bg": light.dashBg ?? DEFAULTS.light.dashBg,
      ...(light.readingTitle
        ? { "--site-reading-title": light.readingTitle }
        : {}),
      ...(light.readingHeading
        ? { "--site-reading-heading": light.readingHeading }
        : {}),
      ...(light.readingBody
        ? { "--site-reading-body": light.readingBody }
        : {}),
      ...(light.readingQuote
        ? { "--site-reading-quote": light.readingQuote }
        : {}),
    },
    dark: {
      "--background": dark.bg,
      "--foreground": dark.fg,
      "--card": dark.bg,
      "--card-foreground": dark.fg,
      "--popover": dark.bg,
      "--popover-foreground": dark.fg,
      "--primary": dark.primary,
      "--primary-foreground": dark.primaryFg,
      "--site-accent": dark.siteAccent,
      "--secondary": dark.muted,
      "--secondary-foreground": dark.fg,
      "--muted": dark.muted,
      "--muted-foreground": dark.mutedFg,
      "--accent": dark.muted,
      "--accent-foreground": dark.fg,
      "--destructive": dark.destructive ?? DEFAULTS.dark.destructive,
      "--success": dark.success ?? DEFAULTS.dark.success,
      "--border": dark.border,
      "--input": dark.border,
      "--ring": dark.primary,
      "--sidebar": dark.bg,
      "--sidebar-foreground": dark.fg,
      "--sidebar-primary": dark.primary,
      "--sidebar-primary-foreground": dark.primaryFg,
      "--sidebar-accent": dark.muted,
      "--sidebar-accent-foreground": dark.fg,
      "--sidebar-border": dark.border,
      "--sidebar-ring": dark.primary,
      "--search-mark-bg": dark.searchMarkBg ?? DEFAULTS.dark.searchMarkBg,
      "--search-mark-color":
        dark.searchMarkColor ?? DEFAULTS.dark.searchMarkColor,
      "--dash-bg": dark.dashBg ?? DEFAULTS.dark.dashBg,
      ...(dark.readingTitle
        ? { "--site-reading-title": dark.readingTitle }
        : {}),
      ...(dark.readingHeading
        ? { "--site-reading-heading": dark.readingHeading }
        : {}),
      ...(dark.readingBody ? { "--site-reading-body": dark.readingBody } : {}),
      ...(dark.readingQuote
        ? { "--site-reading-quote": dark.readingQuote }
        : {}),
    },
  };
}

export const BUILTIN_COLOR_THEMES: ColorTheme[] = [
  // Tufte-inspired warm ivory — minimal color, maximum readability
  defineTheme({
    id: "tufte",
    name: "Tufte",
    light: {
      bg: "oklch(0.999 0.007 103)",
      fg: "oklch(0.178 0.004 70)",
      primary: "oklch(0.3633 0.0697 159.95)",
      primaryFg: "oklch(0.995 0.006 103)",
      siteAccent: "oklch(0.4406 0.0568 159.95)",
      muted: "oklch(0.965 0.008 100)",
      mutedFg: "oklch(0.46 0.008 70)",
      border: "oklch(0.925 0.008 100)",
      readingTitle: "oklch(0.155 0.003 70)",
      readingHeading: "oklch(0.178 0.004 70)",
      readingBody: "oklch(0.22 0.005 70)",
      readingQuote: "oklch(0.36 0.008 55)",
      dashBg: "oklch(0.98 0.006 100)",
    },
    dark: {
      bg: "oklch(0.17 0.006 70)",
      fg: "oklch(0.92 0.006 100)",
      primary: "oklch(0.6966 0.0528 159.95)",
      primaryFg: "oklch(0.155 0.005 70)",
      siteAccent: "oklch(0.7306 0.0478 159.95)",
      muted: "oklch(0.225 0.006 70)",
      mutedFg: "oklch(0.62 0.006 95)",
      border: "oklch(0.29 0.006 70)",
      dashBg: "oklch(0.15 0.005 70)",
    },
  }),

  // Warm cream with green accent — the signature Jant palette
  defineTheme({
    id: "linen",
    name: "Linen",
    light: {
      bg: "oklch(0.975 0.015 92)",
      fg: "oklch(0.29 0.01 70)",
      primary: "oklch(0.3633 0.0697 159.95)",
      primaryFg: "oklch(0.985 0.008 92)",
      siteAccent: "oklch(0.4406 0.0568 159.95)",
      muted: "oklch(0.942 0.014 96)",
      mutedFg: "oklch(0.52 0.008 70)",
      border: "oklch(0.892 0.014 98)",
      destructive: "oklch(0.56 0.21 24)",
      success: "oklch(0.56 0.11 158)",
      dashBg: "oklch(0.955 0.012 92)",
      readingTitle: "oklch(0.208 0.009 60)",
      readingHeading: "oklch(0.226 0.01 62)",
      readingBody: "oklch(0.242 0.012 58)",
      readingQuote: "oklch(0.232 0.012 60)",
    },
    dark: {
      bg: "oklch(0.182 0.003 95)",
      fg: "oklch(0.895 0.006 88)",
      primary: "oklch(0.6966 0.0528 159.95)",
      primaryFg: "oklch(0.17 0.003 95)",
      siteAccent: "oklch(0.7306 0.0478 159.95)",
      muted: "oklch(0.238 0.003 95)",
      mutedFg: "oklch(0.67 0.005 88)",
      border: "oklch(0.305 0.003 95)",
      destructive: "oklch(0.67 0.18 22)",
      success: "oklch(0.66 0.075 156)",
      searchMarkBg: "oklch(0.37 0.026 82 / 0.42)",
      searchMarkColor: "oklch(0.94 0.012 90)",
      dashBg: "oklch(0.165 0.003 95)",
    },
  }),

  // Mint-white with deep indigo text — cool, refined tension
  defineTheme({
    id: "frost",
    name: "Frost",
    light: {
      bg: "oklch(0.993 0.006 158)",
      fg: "oklch(0.22 0.035 272)",
      primary: "oklch(0.3 0.14 272)",
      primaryFg: "oklch(0.99 0.005 158)",
      siteAccent: "oklch(0.42 0.12 265)",
      muted: "oklch(0.96 0.008 160)",
      mutedFg: "oklch(0.45 0.03 270)",
      border: "oklch(0.92 0.01 162)",
      readingTitle: "oklch(0.18 0.04 274)",
      readingHeading: "oklch(0.21 0.035 273)",
      readingBody: "oklch(0.25 0.03 272)",
      readingQuote: "oklch(0.38 0.025 270)",
      dashBg: "oklch(0.975 0.005 158)",
    },
    dark: {
      bg: "oklch(0.17 0.03 272)",
      fg: "oklch(0.92 0.006 160)",
      primary: "oklch(0.75 0.1 268)",
      primaryFg: "oklch(0.15 0.025 272)",
      siteAccent: "oklch(0.72 0.09 260)",
      muted: "oklch(0.23 0.025 272)",
      mutedFg: "oklch(0.65 0.01 158)",
      border: "oklch(0.3 0.025 272)",
      dashBg: "oklch(0.15 0.025 272)",
    },
  }),

  // Warm ivory white with tea-green accent — barely-there warmth
  defineTheme({
    id: "cotton",
    name: "Cotton",
    light: {
      bg: "oklch(0.997 0.005 95)",
      fg: "oklch(0.23 0.02 55)",
      primary: "oklch(0.42 0.055 146)",
      primaryFg: "oklch(0.995 0.004 95)",
      siteAccent: "oklch(0.5 0.05 148)",
      muted: "oklch(0.965 0.006 95)",
      mutedFg: "oklch(0.5 0.012 55)",
      border: "oklch(0.93 0.006 95)",
      readingTitle: "oklch(0.19 0.018 52)",
      readingHeading: "oklch(0.21 0.018 54)",
      readingBody: "oklch(0.26 0.016 55)",
      readingQuote: "oklch(0.4 0.012 52)",
      dashBg: "oklch(0.98 0.004 95)",
    },
    dark: {
      bg: "oklch(0.175 0.01 55)",
      fg: "oklch(0.91 0.005 90)",
      primary: "oklch(0.76 0.05 148)",
      primaryFg: "oklch(0.16 0.008 55)",
      siteAccent: "oklch(0.74 0.045 150)",
      muted: "oklch(0.23 0.008 55)",
      mutedFg: "oklch(0.64 0.006 90)",
      border: "oklch(0.295 0.008 55)",
      dashBg: "oklch(0.155 0.008 55)",
    },
  }),

  // Near-white with minimal warm tint — clean paper feel
  defineTheme({
    id: "bone",
    name: "Bone",
    light: {
      bg: "oklch(0.98 0.008 75)",
      fg: "oklch(0.22 0.008 60)",
      primary: "oklch(0.38 0.028 138)",
      primaryFg: "oklch(0.985 0.005 75)",
      siteAccent: "oklch(0.46 0.024 140)",
      muted: "oklch(0.948 0.008 78)",
      mutedFg: "oklch(0.5 0.006 60)",
      border: "oklch(0.905 0.008 78)",
      readingTitle: "oklch(0.18 0.006 55)",
      readingHeading: "oklch(0.2 0.007 58)",
      readingBody: "oklch(0.25 0.008 60)",
      readingQuote: "oklch(0.38 0.006 55)",
      dashBg: "oklch(0.965 0.006 75)",
    },
    dark: {
      bg: "oklch(0.175 0.005 70)",
      fg: "oklch(0.9 0.006 78)",
      primary: "oklch(0.78 0.028 140)",
      primaryFg: "oklch(0.16 0.004 70)",
      siteAccent: "oklch(0.76 0.024 142)",
      muted: "oklch(0.23 0.005 70)",
      mutedFg: "oklch(0.65 0.005 78)",
      border: "oklch(0.295 0.005 70)",
      dashBg: "oklch(0.155 0.004 70)",
    },
  }),

  // Warm yellow-tinted parchment with olive-green accent — old-world classical feel
  defineTheme({
    id: "parchment",
    name: "Parchment",
    light: {
      bg: "oklch(0.978 0.018 87)",
      fg: "oklch(0.31 0.014 72)",
      primary: "oklch(0.5 0.06 142)",
      primaryFg: "oklch(0.987 0.01 88)",
      siteAccent: "oklch(0.58 0.055 145)",
      muted: "oklch(0.946 0.018 88)",
      mutedFg: "oklch(0.55 0.012 72)",
      border: "oklch(0.898 0.018 89)",
      destructive: "oklch(0.54 0.19 24)",
      success: "oklch(0.53 0.09 150)",
      searchMarkBg: "oklch(0.9 0.06 80 / 0.55)",
      searchMarkColor: "oklch(0.34 0.03 70)",
      dashBg: "oklch(0.959 0.015 87)",
    },
    dark: {
      bg: "oklch(0.205 0.016 72)",
      fg: "oklch(0.89 0.012 88)",
      primary: "oklch(0.79 0.065 144)",
      primaryFg: "oklch(0.18 0.014 72)",
      siteAccent: "oklch(0.82 0.06 146)",
      muted: "oklch(0.265 0.014 74)",
      mutedFg: "oklch(0.66 0.01 88)",
      border: "oklch(0.33 0.015 76)",
      destructive: "oklch(0.67 0.18 22)",
      success: "oklch(0.65 0.1 150)",
      searchMarkBg: "oklch(0.43 0.055 78 / 0.5)",
      searchMarkColor: "oklch(0.93 0.03 90)",
      dashBg: "oklch(0.185 0.013 72)",
    },
  }),

  // Warm sand with herb-green accent — desert warmth, dry-growth contrast
  defineTheme({
    id: "dune",
    name: "Dune",
    light: {
      bg: "oklch(0.972 0.01 82)",
      fg: "oklch(0.29 0.018 55)",
      primary: "oklch(0.44 0.075 160)",
      primaryFg: "oklch(0.985 0.004 82)",
      siteAccent: "oklch(0.53 0.065 158)",
      muted: "oklch(0.934 0.013 82)",
      mutedFg: "oklch(0.52 0.014 55)",
      border: "oklch(0.885 0.015 82)",
      destructive: "oklch(0.54 0.18 20)",
      success: "oklch(0.49 0.11 175)",
      searchMarkBg: "oklch(0.91 0.045 190 / 0.45)",
      searchMarkColor: "oklch(0.32 0.03 198)",
      dashBg: "oklch(0.952 0.008 82)",
    },
    dark: {
      bg: "oklch(0.265 0.02 210)",
      fg: "oklch(0.88 0.012 82)",
      primary: "oklch(0.8 0.07 162)",
      primaryFg: "oklch(0.22 0.018 210)",
      siteAccent: "oklch(0.77 0.075 158)",
      muted: "oklch(0.325 0.018 210)",
      mutedFg: "oklch(0.67 0.012 82)",
      border: "oklch(0.38 0.016 210)",
      destructive: "oklch(0.68 0.17 18)",
      success: "oklch(0.65 0.12 175)",
      searchMarkBg: "oklch(0.44 0.05 188 / 0.5)",
      searchMarkColor: "oklch(0.93 0.018 84)",
      dashBg: "oklch(0.24 0.016 210)",
    },
  }),

  // Near-colorless neutral — minimal distraction
  defineTheme({
    id: "ink",
    name: "Ink",
    light: {
      bg: "oklch(0.985 0.002 85)",
      fg: "oklch(0.24 0.004 85)",
      primary: "oklch(0.36 0.012 255)",
      primaryFg: "oklch(0.985 0.002 85)",
      siteAccent: "oklch(0.45 0.02 242)",
      muted: "oklch(0.95 0.003 85)",
      mutedFg: "oklch(0.5 0.006 85)",
      border: "oklch(0.89 0.003 85)",
      destructive: "oklch(0.56 0.2 24)",
      success: "oklch(0.49 0.1 170)",
      searchMarkBg: "oklch(0.9 0.018 238 / 0.45)",
      searchMarkColor: "oklch(0.29 0.016 246)",
      dashBg: "oklch(0.97 0.002 85)",
    },
    dark: {
      bg: "oklch(0.22 0.006 260)",
      fg: "oklch(0.94 0.004 85)",
      primary: "oklch(0.83 0.015 248)",
      primaryFg: "oklch(0.18 0.008 260)",
      siteAccent: "oklch(0.8 0.03 238)",
      muted: "oklch(0.28 0.006 260)",
      mutedFg: "oklch(0.66 0.004 85)",
      border: "oklch(0.34 0.006 260)",
      destructive: "oklch(0.67 0.18 22)",
      success: "oklch(0.62 0.11 170)",
      searchMarkBg: "oklch(0.39 0.022 240 / 0.45)",
      searchMarkColor: "oklch(0.94 0.01 90)",
      dashBg: "oklch(0.19 0.005 260)",
    },
  }),

  // Cool blue-gray — slate-like composure
  defineTheme({
    id: "slate",
    name: "Slate",
    light: {
      bg: "oklch(0.958 0.008 238)",
      fg: "oklch(0.28 0.014 242)",
      primary: "oklch(0.43 0.032 242)",
      primaryFg: "oklch(0.985 0.004 236)",
      siteAccent: "oklch(0.51 0.045 228)",
      muted: "oklch(0.918 0.009 238)",
      mutedFg: "oklch(0.52 0.01 242)",
      border: "oklch(0.85 0.01 240)",
      destructive: "oklch(0.55 0.19 20)",
      success: "oklch(0.52 0.08 188)",
      searchMarkBg: "oklch(0.89 0.025 232 / 0.45)",
      searchMarkColor: "oklch(0.3 0.02 240)",
      dashBg: "oklch(0.94 0.008 238)",
    },
    dark: {
      bg: "oklch(0.18 0.012 242)",
      fg: "oklch(0.88 0.008 230)",
      primary: "oklch(0.78 0.04 232)",
      primaryFg: "oklch(0.17 0.012 242)",
      siteAccent: "oklch(0.79 0.055 220)",
      muted: "oklch(0.245 0.012 242)",
      mutedFg: "oklch(0.64 0.008 230)",
      border: "oklch(0.31 0.012 242)",
      destructive: "oklch(0.67 0.18 20)",
      success: "oklch(0.63 0.09 188)",
      searchMarkBg: "oklch(0.39 0.03 228 / 0.45)",
      searchMarkColor: "oklch(0.93 0.02 230)",
      dashBg: "oklch(0.165 0.011 242)",
    },
  }),

  // Soft sage green — calm, natural, Nordic
  defineTheme({
    id: "sage",
    name: "Sage",
    light: {
      bg: "oklch(0.97 0.012 145)",
      fg: "oklch(0.26 0.015 150)",
      primary: "oklch(0.42 0.05 155)",
      primaryFg: "oklch(0.98 0.008 145)",
      siteAccent: "oklch(0.5 0.045 148)",
      muted: "oklch(0.935 0.014 148)",
      mutedFg: "oklch(0.5 0.012 150)",
      border: "oklch(0.89 0.014 148)",
      readingTitle: "oklch(0.2 0.012 148)",
      readingHeading: "oklch(0.22 0.014 150)",
      readingBody: "oklch(0.28 0.015 150)",
      readingQuote: "oklch(0.36 0.012 148)",
      dashBg: "oklch(0.95 0.01 145)",
    },
    dark: {
      bg: "oklch(0.18 0.01 150)",
      fg: "oklch(0.88 0.01 145)",
      primary: "oklch(0.74 0.045 150)",
      primaryFg: "oklch(0.16 0.008 150)",
      siteAccent: "oklch(0.72 0.04 145)",
      muted: "oklch(0.235 0.01 150)",
      mutedFg: "oklch(0.64 0.008 145)",
      border: "oklch(0.3 0.01 150)",
      dashBg: "oklch(0.16 0.008 150)",
    },
  }),

  // Warm terra cotta — earthy red-brown
  defineTheme({
    id: "clay",
    name: "Clay",
    light: {
      bg: "oklch(0.973 0.011 45)",
      fg: "oklch(0.29 0.022 35)",
      primary: "oklch(0.49 0.085 34)",
      primaryFg: "oklch(0.986 0.006 45)",
      siteAccent: "oklch(0.56 0.09 28)",
      muted: "oklch(0.936 0.013 45)",
      mutedFg: "oklch(0.53 0.016 35)",
      border: "oklch(0.888 0.014 45)",
      destructive: "oklch(0.54 0.18 20)",
      success: "oklch(0.5 0.1 145)",
      searchMarkBg: "oklch(0.9 0.05 42 / 0.55)",
      searchMarkColor: "oklch(0.33 0.03 34)",
      dashBg: "oklch(0.954 0.009 45)",
    },
    dark: {
      bg: "oklch(0.19 0.017 28)",
      fg: "oklch(0.88 0.011 45)",
      primary: "oklch(0.76 0.08 34)",
      primaryFg: "oklch(0.17 0.015 28)",
      siteAccent: "oklch(0.78 0.1 26)",
      muted: "oklch(0.25 0.016 28)",
      mutedFg: "oklch(0.65 0.01 45)",
      border: "oklch(0.31 0.016 28)",
      destructive: "oklch(0.67 0.18 18)",
      success: "oklch(0.63 0.11 145)",
      searchMarkBg: "oklch(0.4 0.05 40 / 0.5)",
      searchMarkColor: "oklch(0.93 0.025 45)",
      dashBg: "oklch(0.17 0.014 28)",
    },
  }),

  // Warm orange — the warmest palette
  defineTheme({
    id: "ember",
    name: "Ember",
    light: {
      bg: "oklch(0.968 0.014 68)",
      fg: "oklch(0.28 0.03 45)",
      primary: "oklch(0.47 0.11 45)",
      primaryFg: "oklch(0.985 0.008 70)",
      siteAccent: "oklch(0.57 0.12 55)",
      muted: "oklch(0.93 0.017 68)",
      mutedFg: "oklch(0.51 0.022 45)",
      border: "oklch(0.88 0.02 68)",
      destructive: "oklch(0.52 0.18 18)",
      success: "oklch(0.5 0.12 150)",
      searchMarkBg: "oklch(0.88 0.09 62 / 0.65)",
      searchMarkColor: "oklch(0.31 0.045 42)",
      dashBg: "oklch(0.95 0.012 68)",
    },
    dark: {
      bg: "oklch(0.17 0.022 38)",
      fg: "oklch(0.86 0.018 68)",
      primary: "oklch(0.79 0.1 58)",
      primaryFg: "oklch(0.16 0.02 38)",
      siteAccent: "oklch(0.74 0.12 48)",
      muted: "oklch(0.23 0.02 38)",
      mutedFg: "oklch(0.64 0.016 68)",
      border: "oklch(0.29 0.02 38)",
      destructive: "oklch(0.66 0.18 16)",
      success: "oklch(0.62 0.13 150)",
      searchMarkBg: "oklch(0.4 0.08 55 / 0.55)",
      searchMarkColor: "oklch(0.9 0.04 72)",
      dashBg: "oklch(0.145 0.018 38)",
    },
  }),

  // Near-white warm paper with quiet moss accents — maximum contrast, minimal color
  defineTheme({
    id: "paper",
    name: "Paper",
    light: {
      bg: "oklch(0.998 0.008 105)",
      fg: "oklch(0.155 0.004 85)",
      primary: "oklch(0.3 0.012 148)",
      primaryFg: "oklch(0.995 0.006 105)",
      siteAccent: "oklch(0.4 0.012 146)",
      muted: "oklch(0.96 0.006 100)",
      mutedFg: "oklch(0.46 0.006 85)",
      border: "oklch(0.925 0.006 100)",
      readingTitle: "oklch(0.13 0.003 85)",
      readingHeading: "oklch(0.155 0.004 85)",
      readingBody: "oklch(0.19 0.004 85)",
      readingQuote: "oklch(0.35 0.005 85)",
      dashBg: "oklch(0.98 0.006 100)",
    },
    dark: {
      bg: "oklch(0.155 0.004 85)",
      fg: "oklch(0.92 0.006 100)",
      primary: "oklch(0.82 0.009 148)",
      primaryFg: "oklch(0.14 0.003 85)",
      siteAccent: "oklch(0.78 0.01 146)",
      muted: "oklch(0.215 0.004 85)",
      mutedFg: "oklch(0.62 0.005 95)",
      border: "oklch(0.28 0.004 85)",
      dashBg: "oklch(0.135 0.003 85)",
    },
  }),

  // Pure white with neutral grays — zero tint, clean and clinical
  defineTheme({
    id: "snow",
    name: "Snow",
    light: {
      bg: "oklch(1 0 0)",
      fg: "oklch(0.205 0 0)",
      primary: "oklch(0.25 0 0)",
      primaryFg: "oklch(0.99 0 0)",
      siteAccent: "oklch(0.37 0 0)",
      muted: "oklch(0.965 0 0)",
      mutedFg: "oklch(0.5 0 0)",
      border: "oklch(0.91 0 0)",
      readingTitle: "oklch(0.17 0 0)",
      readingHeading: "oklch(0.205 0 0)",
      readingBody: "oklch(0.24 0 0)",
      readingQuote: "oklch(0.4 0 0)",
      dashBg: "oklch(0.975 0 0)",
    },
    dark: {
      bg: "oklch(0.17 0 0)",
      fg: "oklch(0.92 0 0)",
      primary: "oklch(0.85 0 0)",
      primaryFg: "oklch(0.17 0 0)",
      siteAccent: "oklch(0.78 0 0)",
      muted: "oklch(0.235 0 0)",
      mutedFg: "oklch(0.65 0 0)",
      border: "oklch(0.3 0 0)",
      dashBg: "oklch(0.15 0 0)",
    },
  }),

  // Deep coffee brown — rich and grounded
  defineTheme({
    id: "espresso",
    name: "Espresso",
    light: {
      bg: "oklch(0.972 0.01 70)",
      fg: "oklch(0.26 0.018 50)",
      primary: "oklch(0.4 0.055 50)",
      primaryFg: "oklch(0.985 0.007 70)",
      siteAccent: "oklch(0.48 0.05 45)",
      muted: "oklch(0.938 0.012 72)",
      mutedFg: "oklch(0.5 0.014 50)",
      border: "oklch(0.892 0.012 72)",
      readingTitle: "oklch(0.2 0.016 48)",
      readingHeading: "oklch(0.22 0.016 50)",
      readingBody: "oklch(0.28 0.018 52)",
      readingQuote: "oklch(0.38 0.014 48)",
      dashBg: "oklch(0.952 0.008 70)",
    },
    dark: {
      bg: "oklch(0.17 0.012 45)",
      fg: "oklch(0.87 0.01 70)",
      primary: "oklch(0.75 0.05 55)",
      primaryFg: "oklch(0.15 0.01 45)",
      siteAccent: "oklch(0.72 0.045 48)",
      muted: "oklch(0.225 0.012 45)",
      mutedFg: "oklch(0.63 0.008 70)",
      border: "oklch(0.29 0.012 45)",
      dashBg: "oklch(0.15 0.01 45)",
    },
  }),
];
