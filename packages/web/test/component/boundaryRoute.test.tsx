import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';

vi.mock('../../src/screens/demo/DemoLauncher', () => ({
  DemoLauncher: (): never => {
    throw new Error('plainly broken screen');
  },
}));

describe('top level boundary on a real route', () => {
  it('replaces a screen that throws with the recovery screen, banner and error id', () => {
    const quiet = vi.spyOn(globalThis.console, 'error').mockImplementation(() => undefined);
    const { container } = render(<App initialPath="/demo" />);
    quiet.mockRestore();
    expect(container.querySelector('[data-route="error"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('err.boundary'));
    expect(screen.getByText(t('banner.sandbox'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('err.reload') })).toBeTruthy();
    expect(screen.getByRole('link', { name: t('err.home') }).getAttribute('href')).toBe('/');
  });
});
