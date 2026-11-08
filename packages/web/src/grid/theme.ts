import { themeQuartz } from 'ag-grid-community';

/**
 * Newsprint tokens as plain values for the AG Grid theming API. The grid builds its own CSS custom
 * properties from these, so they are literals; test/unit/gridTheme.test.ts reads tokens.css and fails
 * if one of them drifts from the light palette.
 */
export const GRID_COLORS = {
  surface: '#f8f2e4',
  raised: '#e6dac1',
  rule: '#d3c5a8',
  fg: '#1d1712',
  muted: '#5a4d3f',
  border: '#7a6a57',
  accent: '#a33a06',
  danger: '#b3261e',
  success: '#256b3a',
  action: '#ff6a1f',
} as const;

const MONO = "'JetBrains Mono Variable', ui-monospace, Menlo, Consolas, monospace";
const SANS =
  "'Public Sans Variable', 'Inter Variable', system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * AG Grid Quartz, mapped to Newsprint: paper surface, ink text, hard borders, square corners,
 * mono numerals (set per column with the gv-grid-num class) and a thick ink focus ring.
 * Light only; there is no dark mode for the grids.
 */
export const gavelTheme = themeQuartz.withParams({
  accentColor: GRID_COLORS.accent,
  backgroundColor: GRID_COLORS.surface,
  foregroundColor: GRID_COLORS.fg,
  textColor: GRID_COLORS.fg,
  borderColor: GRID_COLORS.border,
  chromeBackgroundColor: GRID_COLORS.raised,
  headerBackgroundColor: GRID_COLORS.raised,
  headerTextColor: GRID_COLORS.fg,
  headerFontWeight: 700,
  headerFontFamily: SANS,
  fontFamily: SANS,
  fontSize: 14,
  oddRowBackgroundColor: '#f2eada',
  rowHoverColor: '#ece1c9',
  selectedRowBackgroundColor: '#e6dac1',
  rowBorder: { style: 'solid', width: 1, color: GRID_COLORS.rule },
  columnBorder: false,
  headerColumnBorder: false,
  wrapperBorder: { style: 'solid', width: 2, color: GRID_COLORS.fg },
  wrapperBorderRadius: 0,
  borderRadius: 0,
  pinnedColumnBorder: { style: 'solid', width: 2, color: GRID_COLORS.fg },
  pinnedRowBorder: { style: 'solid', width: 2, color: GRID_COLORS.fg },
  pinnedRowFontWeight: 700,
  pinnedRowBackgroundColor: GRID_COLORS.raised,
  valueChangeValueHighlightBackgroundColor: 'rgba(255, 106, 31, 0.35)',
  inputFocusBorder: { style: 'solid', width: 2, color: GRID_COLORS.fg },
  focusShadow: { spread: 3, color: GRID_COLORS.fg, offsetX: 0, offsetY: 0, radius: 0 },
  rowHeight: 40,
  headerHeight: 44,
  spacing: 6,
});

export const GRID_FONT_MONO = MONO;
