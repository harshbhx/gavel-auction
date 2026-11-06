import { fireEvent, render, screen } from '@testing-library/react';
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

describe('replay player', () => {
  it('shows the chapter controls and no settlement before the settlement chapter', async () => {
    mount();
    expect(await screen.findByRole('button', { name: t('replay.chapter.settle') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('replay.chapter.hammer') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('replay.speed', { x: 2 }) })).toBeTruthy();
    expect(screen.queryByTestId('settlement-panel')).toBeNull();
  });

  it('seeks to a chapter and shows the ladder after settlement, then seeks back', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: t('replay.chapter.settle') }));
    expect(screen.getByTestId('settlement-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('replay.chapter.bid') }));
    expect(screen.queryByTestId('settlement-panel')).toBeNull();
  });

  it('changes speed and pauses through the transport controls', async () => {
    mount();
    const faster = await screen.findByRole('button', { name: t('replay.speed', { x: 4 }) });
    fireEvent.click(faster);
    expect(faster.getAttribute('aria-pressed')).toBe('true');
    const play = screen.getByRole('button', { name: t('console.resume') });
    fireEvent.click(play);
    expect(screen.getByRole('button', { name: t('console.pause') })).toBeTruthy();
  });

  it('shows the big screen view with the recorded lot title', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: t('demo.roleScreen') }));
    expect(screen.getByRole('heading', { level: 1, name: bundle.title })).toBeTruthy();
  });
});
