// ---------------------------------------------------------------------------
// Novara AI — local UI settings (Step 62).
//
// LOCAL ONLY: no table, no server state, no account field. The keys live in
// this browser's localStorage.
//
//   novara.settings.theme     — reserved for the theme preference. NOTHING
//     writes it yet: the app has no theme provider (no component toggles the
//     `dark` class on <html>), so a theme control would be a dead switch.
//     The key is declared so the future provider has one place to agree on.
//   novara.settings.fontScale — the editor font scale. It is applied as the
//     CSS variable --novara-font-scale on <html>; the editor does not
//     consume it yet (the chapter editor uses fixed text sizes), so the
//     visible effect is deferred — the preference is stored and applied, the
//     typography follows in a later round.
// ---------------------------------------------------------------------------

export const SETTINGS_KEY_THEME = "novara.settings.theme";
export const SETTINGS_KEY_FONT_SCALE = "novara.settings.fontScale";

export type FontScaleId = "small" | "standard" | "large" | "xlarge";

export interface FontScaleOption {
  id: FontScaleId;
  label: string;
  /** The value of --novara-font-scale. */
  scale: number;
}

/** The four editor sizes (segmented control in Settings -> General). */
export const FONT_SCALE_OPTIONS: FontScaleOption[] = [
  { id: "small", label: "Small", scale: 0.9 },
  { id: "standard", label: "Standard", scale: 1 },
  { id: "large", label: "Large", scale: 1.15 },
  { id: "xlarge", label: "Extra large", scale: 1.3 },
];

const DEFAULT_FONT_SCALE: FontScaleId = "standard";

function isFontScaleId(value: unknown): value is FontScaleId {
  return FONT_SCALE_OPTIONS.some((option) => option.id === value);
}

export function readFontScale(): FontScaleId {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY_FONT_SCALE);
    return isFontScaleId(raw) ? raw : DEFAULT_FONT_SCALE;
  } catch {
    return DEFAULT_FONT_SCALE;
  }
}

/**
 * Apply the scale to the document: --novara-font-scale on <html>. The editor
 * does not read it yet — the variable is the seam a later round wires into
 * the prose surfaces.
 */
export function applyFontScale(id: FontScaleId): void {
  if (typeof document === "undefined") return;
  const option = FONT_SCALE_OPTIONS.find((entry) => entry.id === id);
  if (!option) return;
  document.documentElement.style.setProperty(
    "--novara-font-scale",
    String(option.scale),
  );
}

/** Persist the scale and apply it immediately. */
export function writeFontScale(id: FontScaleId): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY_FONT_SCALE, id);
  } catch {
    // storage unavailable — the preference is best-effort
  }
  applyFontScale(id);
}
