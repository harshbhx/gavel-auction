import { describe, expect, it } from 'vitest';
import {
  forcedColorsPasses,
  forcedColorsResult,
  zoomPasses,
  zoomResult,
  type BoundaryMeasure,
  type ControlMeasure,
} from '../src/a11y/emulation';

// The decisions behind the 200 percent zoom and forced colours emulation specs (issue 2195). The
// browser measures; these rules decide, so they are tested without a browser.

const control = (over: Partial<ControlMeasure> = {}): ControlMeasure => ({
  desc: 'button.bid',
  left: 20,
  right: 220,
  width: 200,
  height: 44,
  skipLink: false,
  inScrollContainer: false,
  clipsOwnText: false,
  ...over,
});

describe('zoomResult', () => {
  it('passes controls inside the viewport with no page scroll', () => {
    const r = zoomResult(640, 640, [control()]);
    expect(r.horizontalScroll).toBe(false);
    expect(r.findings).toEqual([]);
    expect(zoomPasses(r)).toBe(true);
  });
  it('flags sideways page scroll, with one pixel of rounding allowed', () => {
    expect(zoomResult(640, 641, []).horizontalScroll).toBe(false);
    const r = zoomResult(640, 700, []);
    expect(r.horizontalScroll).toBe(true);
    expect(zoomPasses(r)).toBe(false);
  });
  it('flags a control past the right or left edge', () => {
    const r = zoomResult(640, 640, [
      control({ desc: 'a.right', right: 700 }),
      control({ desc: 'a.left', left: -30, right: 100 }),
    ]);
    expect(r.findings.map((f) => f.desc)).toEqual(['a.right', 'a.left']);
  });
  it('allows a control inside a table that scrolls sideways on purpose', () => {
    expect(
      zoomResult(640, 640, [control({ right: 900, inScrollContainer: true })]).findings,
    ).toEqual([]);
  });
  it('allows a skip link parked off screen and hidden inputs', () => {
    const r = zoomResult(640, 640, [
      control({ desc: 'a.skip', skipLink: true, left: -9999, right: -9000 }),
      control({ desc: 'input.radio', left: -50, right: -49, width: 1, height: 1 }),
    ]);
    expect(r.findings).toEqual([]);
  });
  it('flags text clipped by the control own box', () => {
    const r = zoomResult(640, 640, [control({ desc: 'button.long', clipsOwnText: true })]);
    expect(r.findings).toEqual([{ desc: 'button.long', reason: 'text clipped by its own box' }]);
  });
});

const boundary = (over: Partial<BoundaryMeasure> = {}): BoundaryMeasure => ({
  desc: 'button.primary',
  tag: 'button',
  width: 120,
  height: 40,
  borderWidthPx: 2,
  borderStyle: 'solid',
  outlineStyle: 'none',
  outlineWidthPx: 0,
  textDecoration: 'none',
  ...over,
});

describe('forcedColorsResult', () => {
  it('passes when every control keeps a border, an outline or an underline', () => {
    const r = forcedColorsResult(true, [
      boundary(),
      boundary({
        desc: 'input.x',
        tag: 'input',
        borderWidthPx: 0,
        outlineStyle: 'solid',
        outlineWidthPx: 2,
      }),
      boundary({
        desc: 'a.link',
        tag: 'a',
        borderWidthPx: 0,
        borderStyle: 'none',
        textDecoration: 'underline',
      }),
    ]);
    expect(r.borderless).toEqual([]);
    expect(forcedColorsPasses(r)).toBe(true);
  });
  it('lists a borderless button and a link with no underline', () => {
    const r = forcedColorsResult(true, [
      boundary({ desc: 'button.flat', borderWidthPx: 0, borderStyle: 'none' }),
      boundary({ desc: 'a.plain', tag: 'a', borderWidthPx: 0, borderStyle: 'none' }),
    ]);
    expect(r.borderless).toEqual(['button.flat', 'a.plain']);
    expect(forcedColorsPasses(r)).toBe(false);
  });
  it('does not count a hidden style or a zero width border as a boundary', () => {
    expect(forcedColorsResult(true, [boundary({ borderStyle: 'hidden' })]).borderless).toHaveLength(
      1,
    );
    expect(forcedColorsResult(true, [boundary({ borderWidthPx: 0 })]).borderless).toHaveLength(1);
  });
  it('is not a pass when the forced colours query did not match', () => {
    expect(forcedColorsPasses(forcedColorsResult(false, [boundary()]))).toBe(false);
  });
  it('ignores controls with no size', () => {
    const r = forcedColorsResult(true, [
      boundary({ width: 0, borderWidthPx: 0, borderStyle: 'none' }),
    ]);
    expect(r.controls).toBe(0);
    expect(r.borderless).toEqual([]);
  });
});
