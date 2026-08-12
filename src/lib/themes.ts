import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Site-wide accent-color theming (buttons, primarily) — an Agency Head
// picks one for their whole agency (src/app/agency/settings), applied via
// CSS variables set on <html> in the root layout. Deliberately named after
// the color itself, not the insurance company whose branding it evokes —
// "sunburst", not "sun life".
export type ThemeId = "classic" | "sunburst" | "ruby" | "emerald" | "sapphire" | "markeys";

export type ThemeDefinition = {
  id: ThemeId;
  label: string;
  description: string;
  // CSS <color> or <image> value for the picker UI's swatch — a solid hex
  // for flat themes, a gradient for markeys.
  swatch: string;
  vars: {
    "--color-primary": string;
    "--color-primary-hover": string;
    "--color-primary-foreground": string;
    // "none" for every flat theme; only markeys sets a real gradient here.
    "--color-primary-gradient": string;
  };
};

export const DEFAULT_THEME_ID: ThemeId = "markeys";

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  classic: {
    id: "classic",
    label: "Classic",
    description: "The original black-and-white look — no particular brand association.",
    swatch: "#111827",
    vars: {
      "--color-primary": "#111827",
      "--color-primary-hover": "#1f2937",
      "--color-primary-foreground": "#ffffff",
      "--color-primary-gradient": "none",
    },
  },
  sunburst: {
    id: "sunburst",
    label: "Sunburst",
    description: "Warm gold and yellow.",
    swatch: "#f2a900",
    vars: {
      "--color-primary": "#f2a900",
      "--color-primary-hover": "#d69400",
      // Dark text, not white — needed for real contrast against a bright
      // gold/yellow background.
      "--color-primary-foreground": "#171208",
      "--color-primary-gradient": "none",
    },
  },
  ruby: {
    id: "ruby",
    label: "Ruby",
    description: "Bold red.",
    swatch: "#d71921",
    vars: {
      "--color-primary": "#d71921",
      "--color-primary-hover": "#b5141b",
      "--color-primary-foreground": "#ffffff",
      "--color-primary-gradient": "none",
    },
  },
  emerald: {
    id: "emerald",
    label: "Emerald",
    description: "Deep green.",
    swatch: "#00693e",
    vars: {
      "--color-primary": "#00693e",
      "--color-primary-hover": "#00522f",
      "--color-primary-foreground": "#ffffff",
      "--color-primary-gradient": "none",
    },
  },
  sapphire: {
    id: "sapphire",
    label: "Sapphire",
    description: "Rich blue.",
    swatch: "#0056a6",
    vars: {
      "--color-primary": "#0056a6",
      "--color-primary-hover": "#00417d",
      "--color-primary-foreground": "#ffffff",
      "--color-primary-gradient": "none",
    },
  },
  markeys: {
    id: "markeys",
    label: "Markey's Theme",
    description: "A teal-to-royal-velvet-blue gradient.",
    swatch: "linear-gradient(135deg, #14b8a6 0%, #241e7a 100%)",
    vars: {
      // Solid fallback/hover color — the gradient's deep-blue end, for
      // contexts where a gradient can't apply.
      "--color-primary": "#241e7a",
      "--color-primary-hover": "#181253",
      "--color-primary-foreground": "#ffffff",
      "--color-primary-gradient": "linear-gradient(135deg, #14b8a6 0%, #241e7a 100%)",
    },
  },
};

export const THEME_LIST = Object.values(THEMES);

export function isValidThemeId(value: string): value is ThemeId {
  return value in THEMES;
}

export function resolveThemeVars(themeId: string | null | undefined) {
  if (themeId && isValidThemeId(themeId)) {
    return THEMES[themeId].vars;
  }
  return THEMES[DEFAULT_THEME_ID].vars;
}

// Read by the root layout on every request, before any page-level
// requireSession()/requireAgencySession() call runs — /login and /setup
// have no session at all, and a Super Admin has no agencyId, so both fall
// through to the neutral default rather than throwing.
export async function getSiteThemeVars() {
  const session = await auth();
  const agencyId = session?.user?.agencyId;
  if (!agencyId) {
    return THEMES[DEFAULT_THEME_ID].vars;
  }
  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { theme: true } });
  return resolveThemeVars(agency?.theme);
}

type ActionResult = { ok: true } | { ok: false; error: string };

// Agency itself isn't in tenant-db.ts's TENANT_SCOPED_MODELS (it's the
// tenant root, not a row scoped to one) — same reason system-config.ts and
// insurance-lines.ts's own agency lookups go through the plain client.
export async function setAgencyTheme(agencyId: string, themeId: string): Promise<ActionResult> {
  if (!isValidThemeId(themeId)) {
    return { ok: false, error: "Choose a valid theme." };
  }
  await prisma.agency.update({ where: { id: agencyId }, data: { theme: themeId } });
  return { ok: true };
}
