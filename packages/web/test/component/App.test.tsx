import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';

describe('App', () => {
  it('renders the landing screen at the root', () => {
    render(<App initialPath="/" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('landing.title'));
  });

  it('mounts both live regions once, outside the route', () => {
    render(<App initialPath="/" />);
    expect(screen.getAllByTestId('live-polite')).toHaveLength(1);
    expect(screen.getAllByTestId('live-assertive')).toHaveLength(1);
  });

  it('renders the join screen for a join route', () => {
    render(<App initialPath="/join/room-one" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      t('join.title', { room: 'room-one' }),
    );
  });
});
