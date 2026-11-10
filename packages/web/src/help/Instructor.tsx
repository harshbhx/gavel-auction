import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { t } from '../copy/t';
import { INSTRUCTOR_BUTTONS, type InstructorScreen } from './instructorSteps';
import './instructor.css';

export interface InstructorProps {
  readonly screen: InstructorScreen;
  /** Kept so screens can still report their step; the guide does not use it. */
  readonly current?: number | null;
  /**
   * True on a judge room (a sandbox demo room), false on any other room. Left out, the room is
   * asked once through its id; an unknown or failed answer hides the panel.
   */
  readonly judge?: boolean;
  readonly roomId?: string;
  /** Query string that can force the guide on (?instructor=1, even when seen) or off (?instructor=0). */
  readonly search?: string;
}

const storeKey = (screen: InstructorScreen): string => `gavel:guide:${screen}`;

function wasSeen(screen: InstructorScreen): boolean {
  try {
    return localStorage.getItem(storeKey(screen)) === 'seen';
  } catch {
    return false;
  }
}

function markSeen(screen: InstructorScreen): void {
  try {
    localStorage.setItem(storeKey(screen), 'seen');
  } catch {
    // The guide may show again next time.
  }
}

/** Tests and screenshot jobs run in automated browsers. */
function isAutomatedBrowser(): boolean {
  try {
    if (import.meta.env.MODE === 'test') return true;
    return typeof navigator !== 'undefined' && navigator.webdriver === true;
  } catch {
    return false;
  }
}

/**
 * Automated browsers do not see the panel unless the URL asks for it (?instructor=1), so
 * committed baselines stay the same.
 */
export function instructorEnabled(search: string): boolean {
  const flag = new URLSearchParams(search).get('instructor');
  if (flag === '0') return false;
  if (flag === '1') return true;
  return !isAutomatedBrowser();
}

const judgeAnswers = new Map<string, boolean>();

async function askJudgeRoom(roomId: string): Promise<boolean> {
  const known = judgeAnswers.get(roomId);
  if (known !== undefined) return known;
  try {
    const { config } = await import('../config');
    const res = await fetch(`${config.apiBase}/api/auctions/${encodeURIComponent(roomId)}`);
    if (!res.ok) return false;
    const body = (await res.json()) as { judgeRoom?: unknown };
    const is = body.judgeRoom === true;
    judgeAnswers.set(roomId, is);
    return is;
  } catch {
    return false;
  }
}

function useIsJudgeRoom(
  enabled: boolean,
  judge: boolean | undefined,
  roomId: string | undefined,
): boolean {
  const [asked, setAsked] = useState<boolean>(false);
  useEffect(() => {
    if (!enabled || judge !== undefined || roomId === undefined || roomId === '') return undefined;
    let live = true;
    askJudgeRoom(roomId).then((answer) => {
      if (live) setAsked(answer);
    });
    return () => {
      live = false;
    };
  }, [enabled, judge, roomId]);
  return judge ?? asked;
}

/**
 * A small guide card that explains the buttons on a screen, once per device. Closing it (Got it,
 * Escape or a click outside) is remembered; ?instructor=1 shows it again. Not modal: the screen
 * behind stays usable.
 */
export function Instructor({ screen, judge, roomId, search }: InstructorProps) {
  const query = search ?? window.location.search;
  const enabled = instructorEnabled(query);
  const forced = new URLSearchParams(query).get('instructor') === '1';
  const isJudge = useIsJudgeRoom(enabled, judge, roomId);
  const [open, setOpen] = useState(() => forced || !wasSeen(screen));
  const headingId = useId();
  const cardRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const shown = enabled && isJudge && open;

  const close = useCallback((): void => {
    markSeen(screen);
    setOpen(false);
  }, [screen]);

  useEffect(() => {
    if (!shown) return undefined;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    const onPointer = (e: PointerEvent): void => {
      const card = cardRef.current;
      if (card !== null && e.target instanceof Node && !card.contains(e.target)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      if (before !== null && before.isConnected) before.focus();
    };
  }, [shown, close]);

  if (!shown) return null;
  return (
    <section
      ref={cardRef}
      className="gv-instructor"
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      data-screen={screen}
    >
      <h2 className="gv-instructor__title ui-kicker" id={headingId} ref={headingRef} tabIndex={-1}>
        {t('instructor.title')}
      </h2>
      <p className="gv-instructor__lead">{t('instructor.lead')}</p>
      <ul className="gv-instructor__buttons">
        {INSTRUCTOR_BUTTONS[screen].map((b) => (
          <li key={b.name}>
            <strong className="gv-instructor__name">{t(b.name)}</strong>
            <span className="gv-instructor__text">{t(b.text)}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="gv-instructor__done" onClick={close}>
        {t('instructor.gotIt')}
      </button>
    </section>
  );
}
