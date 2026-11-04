import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import ReplayScreen from '../../src/screens/replay/ReplayScreen';
import { happy } from '../../src/testing/scenarios/happy';

const valid = {
  version: 1,
  title: 'Spring Gala demo',
  events: happy.steps.flatMap((s) => (s.emit === undefined ? [] : [{ t: s.at, msg: s.emit }])),
};

describe('ReplayScreen', () => {
  it('shows the recorded badge and the read-only notice for a valid bundle', async () => {
    render(
      <ReplayScreen recordingId="r1" autoplay={false} loadBundle={() => Promise.resolve(valid)} />,
    );
    expect(await screen.findByText('Spring Gala demo')).toBeTruthy();
    expect(screen.getByText(t('prov.recorded'))).toBeTruthy();
    expect(screen.getByText(t('replay.readonly'))).toBeTruthy();
    expect(screen.queryByText(t('replay.invalid'))).toBeNull();
  });

  it('shows replay.invalid for a bundle with the wrong shape', async () => {
    render(
      <ReplayScreen
        recordingId="r1"
        autoplay={false}
        loadBundle={() => Promise.resolve({ version: 9 })}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(t('replay.invalid'));
  });

  it('shows replay.invalid when the bundle cannot be loaded', async () => {
    render(
      <ReplayScreen
        recordingId="r1"
        autoplay={false}
        loadBundle={() => Promise.reject(new Error('offline'))}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(t('replay.invalid'));
  });
});
