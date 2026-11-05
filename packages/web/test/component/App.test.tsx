import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';

const API = { apiBase: 'http://localhost:1', payments: 'fake', paypalClientId: 'none' } as const;

describe('App', () => {
  it('renders the landing screen at the root', () => {
    render(<App initialPath="/" api={API} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('landing.title'));
  });

  it('mounts both live regions once, outside the route', () => {
    render(<App initialPath="/" api={API} />);
    expect(screen.getAllByTestId('live-polite')).toHaveLength(1);
    expect(screen.getAllByTestId('live-assertive')).toHaveLength(1);
  });
});
