import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';

afterEach(() => {
  window.sessionStorage.clear();
});

// Static role and name audit. The axe-core engine is not a dependency of this package yet, so
// these assertions cover the same rule families that matter most: names, labels, ids, headings.
const ROUTES: readonly string[] = [
  '/',
  '/demo',
  '/join/r1',
  '/r/r1/register',
  '/r/r1/bid',
  '/r/r1/receipt',
  '/r/r1/screen',
  '/r/r1/audit',
  '/replay/abc',
  '/gallery',
  '/nope/at/all',
];

function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null && label.trim().length > 0) return label.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by !== null) {
    const text = by
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text.length > 0) return text;
  }
  return (el.textContent ?? '').trim();
}

describe.each(ROUTES)('a11y structure %s', (path) => {
  it('has exactly one h1 and no empty headings', () => {
    const { container } = render(<App initialPath={path} gallery />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    for (const h of Array.from(container.querySelectorAll('h1,h2,h3,h4'))) {
      expect((h.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('gives every button and link an accessible name', () => {
    const { container } = render(<App initialPath={path} gallery />);
    for (const el of Array.from(container.querySelectorAll('button,a[href],[role="button"]'))) {
      const title = el.getAttribute('title') ?? '';
      expect(nameOf(el).length + title.length).toBeGreaterThan(0);
    }
  });

  it('labels every form control', () => {
    const { container } = render(<App initialPath={path} gallery />);
    const controls = container.querySelectorAll('input:not([type="hidden"]),select,textarea');
    for (const el of Array.from(controls)) {
      const id = el.getAttribute('id');
      const labelled =
        (id !== null && container.querySelector(`label[for="${id}"]`) !== null) ||
        el.closest('label') !== null ||
        nameOf(el).length > 0;
      expect(labelled).toBe(true);
    }
  });

  it('has unique ids and hides decorative svg from assistive tech', () => {
    const { container } = render(<App initialPath={path} gallery />);
    const ids = Array.from(container.querySelectorAll('[id]')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const svg of Array.from(container.querySelectorAll('svg'))) {
      const hidden =
        svg.getAttribute('aria-hidden') === 'true' || svg.closest('[aria-hidden="true"]') !== null;
      const named = nameOf(svg).length > 0 || svg.getAttribute('role') === 'img';
      expect(hidden || named).toBe(true);
    }
  });

  it('gives images a text alternative', () => {
    const { container } = render(<App initialPath={path} gallery />);
    for (const img of Array.from(container.querySelectorAll('img'))) {
      expect(img.hasAttribute('alt')).toBe(true);
    }
  });
});
