import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import type { ScenarioTransport } from '../../net/scenarioTransport';
import { useReducedMotion } from '../../ui/fx/hooks';
import {
  BEATS,
  BEAT_MS,
  SPEEDS,
  SPEED_LABEL,
  readStoredSpeed,
  storeSpeed,
  type Beat,
  type PlaybackSpeed,
} from './scriptedBeats';
import { VirtualClock } from './virtualClock';
import './scriptedPlayer.css';

export interface Playback {
  readonly beat: number;
  readonly playing: boolean;
  readonly speed: PlaybackSpeed;
  readonly reduced: boolean;
  readonly finished: boolean;
  /** Scenario time the room starts at; changes only when the room has to be rebuilt. */
  readonly startAt: number;
  /** Bumped each time the room is rebuilt (restart, step back, jump). */
  readonly run: number;
  /** Hand the scenario transport of the mounted room to the player. */
  readonly attach: (transport: ScenarioTransport) => void;
  readonly toggle: () => void;
  readonly next: () => void;
  readonly prev: () => void;
  readonly restart: () => void;
  readonly jump: (index: number) => void;
  readonly setSpeed: (speed: PlaybackSpeed) => void;
}

/**
 * One-beat-at-a-time playback of the scripted scenario. The scenario transport is never left on
 * autoplay: this hook moves its clock to each beat, holds there for a few seconds, then moves on.
 * Going forward by one beat just advances the clock; anything else rebuilds the room at the
 * target beat so no frame is shown twice or out of order.
 */
export function useScriptedPlayback(beats: readonly Beat[] = BEATS): Playback {
  const reduced = useReducedMotion();
  const last = beats.length - 1;
  const [beat, setBeat] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  const [speed, setSpeed] = useState<PlaybackSpeed>(readStoredSpeed);
  const [startAt, setStartAt] = useState(beats[0]?.at ?? 0);
  const [run, setRun] = useState(0);
  const transport = useRef<ScenarioTransport | null>(null);
  const clock = useRef<VirtualClock>(new VirtualClock());
  const dwellBeat = useRef(-1);

  const attach = useCallback((tr: ScenarioTransport) => {
    transport.current = tr;
  }, []);

  const rebuildAt = useCallback(
    (index: number) => {
      transport.current = null;
      clock.current.reset();
      setStartAt(beats[index]?.at ?? 0);
      setRun((n) => n + 1);
      setBeat(index);
    },
    [beats],
  );

  const goTo = useCallback(
    (index: number) => {
      const target = Math.min(Math.max(index, 0), last);
      const tr = transport.current;
      if (tr !== null && target === beat + 1) {
        tr.advance((beats[target]?.at ?? 0) - tr.elapsedMs);
        setBeat(target);
      } else if (target !== beat) {
        rebuildAt(target);
      }
    },
    [beat, beats, last, rebuildAt],
  );

  useEffect(() => {
    if (!playing) return undefined;
    if (beat >= last) {
      setPlaying(false);
      return undefined;
    }
    const c = clock.current;
    if (dwellBeat.current !== beat) {
      dwellBeat.current = beat;
      c.reset();
    }
    c.setSpeed(speed);
    c.start();
    const id = setTimeout(() => goTo(beat + 1), c.realUntil(BEAT_MS));
    return () => {
      clearTimeout(id);
      c.stop();
    };
  }, [playing, beat, speed, run, last, goTo]);

  const chooseSpeed = useCallback((next: PlaybackSpeed) => {
    storeSpeed(next);
    setSpeed(next);
  }, []);

  const finished = beat >= last && !playing;

  return useMemo(
    () => ({
      beat,
      playing,
      speed,
      reduced,
      finished,
      startAt,
      run,
      attach,
      toggle: () => {
        if (finished) {
          rebuildAt(0);
          setPlaying(true);
        } else setPlaying((p) => !p);
      },
      next: () => {
        setPlaying(false);
        goTo(beat + 1);
      },
      prev: () => {
        setPlaying(false);
        goTo(beat - 1);
      },
      restart: () => {
        rebuildAt(0);
        setPlaying(!reduced);
      },
      jump: (index: number) => {
        setPlaying(false);
        goTo(index);
      },
      setSpeed: chooseSpeed,
    }),
    [beat, playing, speed, reduced, finished, startAt, run, attach, goTo, rebuildAt, chooseSpeed],
  );
}

/** Beat copy has no placeholders, so a union of its keys is safe to look up. */
const say = (key: Beat['label'] | Beat['body']): string => t(key as 'scriptedDemo.b0.label');

/** Speed labels have no placeholders, so a union of their keys is safe to look up. */
const speedText = (s: PlaybackSpeed): string => t(SPEED_LABEL[s] as 'scriptedDemo.speed1');

/** Phones fold the step list so the screen and the controls stay in view; wide pages show it. */
function stepsStartOpen(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(min-width: 901px)').matches;
}

/** Caption, transport controls and the step list that sit beside the scripted screen. */
export function ScriptedPlayer({
  playback,
  beats = BEATS,
}: {
  playback: Playback;
  beats?: readonly Beat[];
}) {
  const { beat, playing, speed, finished } = playback;
  const current = beats[beat];
  const total = beats.length;
  const playLabel = finished
    ? t('scriptedDemo.again')
    : playing
      ? t('scriptedDemo.pause')
      : t('scriptedDemo.play');
  return (
    <section
      className="gv-player"
      aria-label={t('scriptedDemo.player')}
      data-testid="scripted-player"
    >
      <p className="gv-player__progress tabular" data-testid="scripted-progress">
        {t('scriptedDemo.progress', { n: beat + 1, total })}
      </p>
      <div
        className="gv-player__caption"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-stage={current?.stage}
        data-testid="scripted-caption"
      >
        <h2 className="gv-player__title">{current === undefined ? '' : say(current.label)}</h2>
        <p className="gv-player__body">{current === undefined ? '' : say(current.body)}</p>
      </div>
      {playback.reduced && <p className="gv-player__note">{t('scriptedDemo.reduced')}</p>}
      {finished && !playback.reduced && <p className="gv-player__note">{t('scriptedDemo.done')}</p>}
      <div className="gv-player__controls">
        <Button onClick={playback.prev} disabled={beat === 0}>
          {t('scriptedDemo.prev')}
        </Button>
        <Button onClick={playback.toggle} data-testid="scripted-toggle">
          {playLabel}
        </Button>
        <Button onClick={playback.next} disabled={beat >= total - 1}>
          {t('scriptedDemo.next')}
        </Button>
        <Button variant="outline" onClick={playback.restart}>
          {t('scriptedDemo.restart')}
        </Button>
      </div>
      <div className="gv-player__speed" role="group" aria-label={t('scriptedDemo.speed')}>
        <span className="gv-player__speed-label" aria-hidden="true">
          {t('scriptedDemo.speed')}
        </span>
        {SPEEDS.map((s) => (
          <Button
            key={s}
            className="gv-player__speed-btn tabular"
            variant={speed === s ? 'solid' : 'outline'}
            aria-pressed={speed === s}
            aria-label={t('scriptedDemo.speedOption', { speed: speedText(s) })}
            data-testid={`scripted-speed-${s}`}
            onClick={() => playback.setSpeed(s)}
          >
            {speedText(s)}
          </Button>
        ))}
      </div>
      <p className="gv-player__note tabular" data-testid="scripted-duration">
        {t('scriptedDemo.duration', {
          seconds: Math.round(((total - 1) * BEAT_MS) / speed / 1000),
          speed: speedText(speed),
        })}
      </p>
      <details className="gv-player__more" open={stepsStartOpen()}>
        <summary>{t('scriptedDemo.allSteps')}</summary>
        <ol className="gv-player__steps" aria-label={t('scriptedDemo.steps')}>
          {beats.map((b, i) => (
            <li
              key={b.at}
              className="gv-player__step"
              data-status={i < beat ? 'done' : i === beat ? 'now' : 'next'}
            >
              <button
                type="button"
                className="gv-player__jump tabular"
                aria-current={i === beat ? 'step' : undefined}
                onClick={() => playback.jump(i)}
              >
                {`${i + 1}. ${say(b.label)}`}
              </button>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
