import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import {
  nextChapterOffset,
  type ChapterMarker,
  type Speed,
} from '../../src/screens/replay/Chapters';
import { Controls, type ReplayView } from '../../src/screens/replay/Controls';

const CHAPTERS: ChapterMarker[] = [
  { id: 'reg', offsetMs: 1000, copyKey: 'replay.chapter.reg' },
  { id: 'hammer', offsetMs: 40000, copyKey: 'replay.chapter.hammer' },
];

function Harness() {
  const [offset, setOffset] = useState(10000);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [view, setView] = useState<ReplayView>('console');
  return (
    <>
      <output data-testid="state">{`${offset}|${playing}|${speed}|${view}`}</output>
      <Controls
        durationMs={60000}
        offsetMs={offset}
        playing={playing}
        speed={speed}
        view={view}
        chapters={CHAPTERS}
        eventOffsets={[2000, 12000, 30000]}
        onSeek={setOffset}
        onPlayingChange={setPlaying}
        onSpeedChange={setSpeed}
        onViewChange={setView}
      />
    </>
  );
}

const state = (): string => screen.getByTestId('state').textContent ?? '';

describe('replay Controls', () => {
  it('toggles play with Space', () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(state()).toBe('10000|true|1|console');
  });

  it('seeks 5 s with the arrow keys and clamps at zero', () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(state().startsWith('15000')).toBe(true);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(state().startsWith('0|')).toBe(true);
  });

  it('steps to the next event with the period key', () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: '.' });
    expect(state().startsWith('12000')).toBe(true);
  });

  it('jumps to a chapter and changes speed', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText(t('replay.chapter.hammer')));
    fireEvent.click(screen.getByText(t('replay.speed', { x: 4 })));
    expect(state()).toBe('40000|false|4|console');
  });

  it('keeps the offset when the view changes', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText(t('ladder.title')));
    fireEvent.click(screen.getByText(t('demo.roleScreen')));
    expect(state()).toBe('10000|false|1|screen');
  });

  it('finds the next chapter', () => {
    expect(nextChapterOffset(CHAPTERS, 1000)).toBe(40000);
    expect(nextChapterOffset(CHAPTERS, 40000)).toBeNull();
  });
});
