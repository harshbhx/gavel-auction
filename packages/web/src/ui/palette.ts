/** Palette switch. The pick is stored in localStorage and applied as data-pal on the root element. */
export const PALETTES = ['a', 'b', 'c'] as const;
export type PaletteName = (typeof PALETTES)[number];

export const PALETTE_STORAGE_KEY = 'gavel.palette';

export function isPalette(value: unknown): value is PaletteName {
  return typeof value === 'string' && (PALETTES as readonly string[]).includes(value);
}

/** The stored palette, or null when nothing valid is stored or storage is blocked. */
export function readStoredPalette(): PaletteName | null {
  try {
    const value = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPalette(value) ? value : null;
  } catch {
    return null;
  }
}

/** Sets data-pal on the root element and keeps the pick; storage failures are ignored. */
export function setPalette(name: PaletteName): void {
  document.documentElement.setAttribute('data-pal', name);
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, name);
  } catch {
    // Private mode or blocked storage: the pick lasts for this page only.
  }
}

/** Applies the stored palette at start-up. Without one, the theme decides (see palettes.css). */
export function initPalette(): PaletteName | null {
  const stored = readStoredPalette();
  if (stored !== null) document.documentElement.setAttribute('data-pal', stored);
  return stored;
}

/** Removes the override so the theme decides again. */
export function clearPalette(): void {
  document.documentElement.removeAttribute('data-pal');
  try {
    window.localStorage.removeItem(PALETTE_STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}
