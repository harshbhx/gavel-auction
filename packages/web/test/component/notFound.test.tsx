import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import {
  NOT_FOUND_DOCS_URL,
  NOT_FOUND_JUDGES_URL,
  NotFound,
} from '../../src/screens/states/NotFound';

// FIX-93: one not-found screen for an unknown page, a missing room and a wrong join code.
describe('the shared not found screen', () => {
  it('page case: short headline, one line of help, the three links, no unrelated panel', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { level: 1, name: t('err.notFound') })).toBeTruthy();
    expect(screen.getByText(t('nf.pageHelp'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('nf.demo') }).getAttribute('href')).toBe('/try');
    expect(screen.getByRole('link', { name: t('nf.judges') }).getAttribute('href')).toBe(
      NOT_FOUND_JUDGES_URL,
    );
    expect(screen.getByRole('link', { name: t('nf.docs') }).getAttribute('href')).toBe(
      NOT_FOUND_DOCS_URL,
    );
    expect(screen.queryByRole('link', { name: t('join.tryAgain') })).toBeNull();
    expect(screen.queryByText(t('mk.how.title'))).toBeNull();
  });

  it.each([
    ['room', 'room.missingTitle', 'room.missingHelp'],
    ['code', 'join.notFound', 'join.notFoundHelp'],
  ] as const)('%s case adds the enter another code link', (kind, title, help) => {
    render(<NotFound kind={kind} />);
    expect(screen.getByRole('heading', { level: 1, name: t(title) })).toBeTruthy();
    expect(screen.getByText(t(help))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('join.tryAgain') }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: t('nf.demo') })).toBeTruthy();
    expect(screen.queryByText(t('join.sandboxNote'))).toBeNull();
  });

  it('takes focus on the heading without a focus ring rule that draws a box', () => {
    render(<NotFound />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    const css = readFileSync(new URL('../../src/a11y/a11y.css', import.meta.url), 'utf8');
    expect(css).toMatch(/h1\[tabindex='-1'\]:focus\s*\{\s*outline: none/);
  });
});
