/**
 * Decisions for the automated proxies of two manual accessibility checks (issue 2195): the 200
 * percent zoom emulation (a 640 by 512 viewport is 200 percent of 1280 by 1024) and the forced
 * colours emulation. The browser only measures; the rules are here so they are unit tested. These
 * are emulations. They never stand in for a person zooming a real browser or using Windows High
 * Contrast, and a green result changes no row of the manual table in docs/A11Y.md.
 */

/** What the page measures about one interactive element. */
export interface ControlMeasure {
  /** A short readable selector for the report, never the element's text. */
  desc: string;
  left: number;
  right: number;
  width: number;
  height: number;
  /** A skip link (href starts with #) parked off screen until focused is hidden by design. */
  skipLink: boolean;
  /** Inside a container that scrolls sideways on purpose (the audit table). */
  inScrollContainer: boolean;
  /** The element clips its own content (overflow hidden or clip) and the content is wider. */
  clipsOwnText: boolean;
}

export interface ZoomFinding {
  desc: string;
  reason: 'outside the viewport' | 'text clipped by its own box';
}

export interface ZoomResult {
  viewportWidth: number;
  documentScrollWidth: number;
  horizontalScroll: boolean;
  controls: number;
  findings: ZoomFinding[];
}

/** An element 2 px wide or less is a visually hidden input (its label is the control). */
const HIDDEN_PX = 2;

export function zoomResult(
  viewportWidth: number,
  documentScrollWidth: number,
  controls: readonly ControlMeasure[],
): ZoomResult {
  const findings: ZoomFinding[] = [];
  for (const c of controls) {
    if (c.width <= HIDDEN_PX || c.height <= HIDDEN_PX) continue;
    if (c.skipLink && c.right <= 0) continue;
    if (!c.inScrollContainer && (c.right > viewportWidth + 1 || c.left < -1)) {
      findings.push({ desc: c.desc, reason: 'outside the viewport' });
    } else if (c.clipsOwnText) {
      findings.push({ desc: c.desc, reason: 'text clipped by its own box' });
    }
  }
  return {
    viewportWidth,
    documentScrollWidth,
    horizontalScroll: documentScrollWidth > viewportWidth + 1,
    controls: controls.length,
    findings,
  };
}

export function zoomPasses(r: ZoomResult): boolean {
  return !r.horizontalScroll && r.findings.length === 0;
}

/** What the page measures about one control under forced colours. */
export interface BoundaryMeasure {
  desc: string;
  tag: string;
  width: number;
  height: number;
  borderWidthPx: number;
  borderStyle: string;
  outlineStyle: string;
  outlineWidthPx: number;
  textDecoration: string;
}

export interface ForcedColorsResult {
  forcedColorsMatches: boolean;
  controls: number;
  borderless: string[];
}

function hasBoundary(c: BoundaryMeasure): boolean {
  if (c.borderStyle !== 'none' && c.borderStyle !== 'hidden' && c.borderWidthPx > 0) return true;
  if (c.outlineStyle !== 'none' && c.outlineWidthPx > 0) return true;
  // A link is told apart by its underline.
  return c.tag === 'a' && c.textDecoration.includes('underline');
}

export function forcedColorsResult(
  forcedColorsMatches: boolean,
  controls: readonly BoundaryMeasure[],
): ForcedColorsResult {
  const seen = controls.filter((c) => c.width > HIDDEN_PX && c.height > HIDDEN_PX);
  return {
    forcedColorsMatches,
    controls: seen.length,
    borderless: seen.filter((c) => !hasBoundary(c)).map((c) => c.desc),
  };
}

/** The emulation only counts when the media query really matched. */
export function forcedColorsPasses(r: ForcedColorsResult): boolean {
  return r.forcedColorsMatches && r.borderless.length === 0;
}
