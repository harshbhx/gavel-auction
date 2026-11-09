import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import ReplayScreen from '../../src/screens/replay/ReplayScreen';
import { happy } from '../../src/testing/scenarios/happy';

const bundle = {
  version: 1,
  title: 'Spring Gala demo',
  events: happy.steps.flatMap((s) => (s.emit === undefined ? [] : [{ t: s.at, msg: s.emit }])),
};

function mount(): void {
  render(
    <ReplayScreen recordingId="r1" autoplay={false} loadBundle={() => Promise.resolve(bundle)} />,
  );
}

// Generous bound for a busy runner; waits return as soon as the condition holds.
const LOAD = { timeout: 10_000 };

describe('replay player', () => {
  it('shows the chapter controls and no settlement before the settlement chapter', async () => {
    mount();
    expect(
      await screen.findByRole('button', { name: t('replay.chapter.settle') }, LOAD),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: t('replay.chapter.hammer') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('replay.speed', { x: 2 }) })).toBeTruthy();
    expect(screen.queryByTestId('settlement-panel')).toBeNull();
  });

  it('seeks to a chapter and shows the ladder after settlement, then seeks back', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: t('replay.chapter.settle') }, LOAD));
    expect(await screen.findByTestId('settlement-panel', {}, LOAD)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('replay.chapter.bid') }));
    await waitFor(() => expect(screen.queryByTestId('settlement-panel')).toBeNull(), LOAD);
  });

  it('changes speed and pauses through the transport controls', async () => {
    mount();
    const faster = await screen.findByRole('button', { name: t('replay.speed', { x: 4 }) }, LOAD);
    fireEvent.click(faster);
    await waitFor(() => expect(faster.getAttribute('aria-pressed')).toBe('true'), LOAD);
    fireEvent.click(await screen.findByRole('button', { name: t('console.resume') }, LOAD));
    expect(await screen.findByRole('button', { name: t('console.pause') }, LOAD)).toBeTruthy();
  });

  it('shows the big screen view with the recorded lot title', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: t('demo.roleScreen') }, LOAD));
    expect(await screen.findByRole('heading', { level: 1, name: bundle.title }, LOAD)).toBeTruthy();
  });
});
