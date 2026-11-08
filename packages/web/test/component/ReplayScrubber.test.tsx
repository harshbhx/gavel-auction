import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import ReplayScreen from '../../src/screens/replay/ReplayScreen';
import { happy } from '../../src/testing/scenarios/happy';

const bundle = {
  version: 1,
  title: 'Spring Gala demo',
  events: happy.steps.flatMap((s) => (s.emit === undefined ? [] : [{ t: s.at, msg: s.emit }])),
};

async function mount(autoplay = false): Promise<HTMLInputElement> {
  render(
    <ReplayScreen
      recordingId="r1"
      autoplay={autoplay}
      loadBundle={() => Promise.resolve(bundle)}
    />,
  );
  const slider = (await screen.findByRole('slider', {
    name: t('replay.scrub.label'),
  })) as HTMLInputElement;
  // findBy resolves as soon as the slider is in the DOM, but the player starts its transport in a
  // passive effect that React may not have run yet. A click before that seeks nothing (value 0),
  // which showed up under load in the property job. Flush the effects before the test acts.
  await act(async () => {});
  return slider;
}

describe('replay scrubber', () => {
  it('draws a marker for every bid and the hammer', async () => {
    await mount();
    expect(screen.getAllByRole('button', { name: /^Bid \$/ })).toHaveLength(5);
    expect(screen.getAllByRole('button', { name: /^Hammer \$350\.00 at / })).toHaveLength(1);
  });

  it('jumps to a marker and speaks the position', async () => {
    const slider = await mount();
    fireEvent.click(
      screen.getByRole('button', {
        name: t('replay.scrub.hammer', { amount: '$350.00', at: '0:15' }),
      }),
    );
    expect(slider.value).toBe('15000');
    expect(slider.getAttribute('aria-valuetext')).toBe(
      t('replay.scrub.value', { at: '0:15', total: '0:18' }),
    );
  });

  it('scrubs by dragging the slider, forward and back', async () => {
    const slider = await mount();
    fireEvent.change(slider, { target: { value: '16000' } });
    expect(screen.getByTestId('settlement-panel')).toBeTruthy();
    fireEvent.change(slider, { target: { value: '2000' } });
    expect(slider.value).toBe('2000');
    expect(screen.queryByTestId('settlement-panel')).toBeNull();
  });

  it('steps through bids with the previous and next buttons', async () => {
    const slider = await mount();
    const prev = screen.getByRole('button', { name: t('replay.scrub.prev') });
    const next = screen.getByRole('button', { name: t('replay.scrub.next') });
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(next);
    expect(slider.value).toBe('1000');
    fireEvent.click(next);
    expect(slider.value).toBe('2000');
    fireEvent.click(prev);
    expect(slider.value).toBe('1000');
  });

  it('is reachable by keyboard: the slider is focusable and markers stay out of the tab order', async () => {
    const slider = await mount();
    expect(slider.tabIndex).toBe(0);
    for (const b of screen.getAllByRole('button', { name: /^(Bid|Hammer) \$/ })) {
      expect(b.tabIndex).toBe(-1);
    }
  });

  it('holds the replay while the handle is down and resumes on release', async () => {
    const slider = await mount(true);
    expect(screen.getByRole('button', { name: t('console.pause') })).toBeTruthy();
    fireEvent.pointerDown(slider);
    expect(screen.getByRole('button', { name: t('console.resume') })).toBeTruthy();
    fireEvent.pointerUp(slider);
    expect(screen.getByRole('button', { name: t('console.pause') })).toBeTruthy();
  });
});
