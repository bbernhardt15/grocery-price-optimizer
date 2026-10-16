export const THEME_KEY = "gg-theme";

/** Browser chrome and the first paint. Dark is a warm charcoal, not pure black. */
export const THEME_COLOR = {
  light: "#0e7a45",
  dark: "#1c221e",
};

/** @param {string | null | undefined} value */
export function parseThemeChoice(value) {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}

/** system → dark → light → system */
export function nextTheme(current) {
  const choice = parseThemeChoice(current);
  if (choice === "system") return "dark";
  if (choice === "dark") return "light";
  return "system";
}

export function themeIsDark(choice, systemDark) {
  const parsed = parseThemeChoice(choice);
  return parsed === "dark" || (parsed === "system" && Boolean(systemDark));
}

export function themeColor(choice, systemDark) {
  return themeIsDark(choice, systemDark) ? THEME_COLOR.dark : THEME_COLOR.light;
}

export function themeGlyph(choice) {
  const parsed = parseThemeChoice(choice);
  if (parsed === "dark") return "☾";
  if (parsed === "light") return "☀";
  return "◐";
}

export function themeButtonLabel(choice, systemDark) {
  const parsed = parseThemeChoice(choice);
  if (parsed === "dark") return "Dark theme on. Switch to light.";
  if (parsed === "light") return "Light theme on. Switch to match this device.";
  return systemDark
    ? "Matching this device (dark). Switch to dark."
    : "Matching this device (light). Switch to dark.";
}
