import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';

describe('/try page', () => {
  it('shows the steps, the credentials pointer and the guided tour link', () => {
    render(<App initialPath="/try" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('try.title'));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText(t('try.credsBody'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('try.tourLink') }).getAttribute('href')).toBe(
      '/demo/scripted',
    );
    expect(screen.getByRole('button', { name: t('landing.start') })).toBeTruthy();
  });
});
