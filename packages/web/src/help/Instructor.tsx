import { useEffect, useId, useState } from 'react';
import { t } from '../copy/t';
import { INSTRUCTOR_STEPS, type InstructorScreen } from './instructorSteps';
import './instructor.css';

export interface InstructorProps {
  readonly screen: InstructorScreen;
  /** Index into the screen's steps, from real room state. Null when it is not known. */
  readonly current?: number | null;
  /**
   * True on a judge room (a sandbox demo room), false on any other room. Left out, the room is
   * asked once through its id; an unknown or failed answer hides the panel.
   */
  readonly judge?: boolean;
  readonly roomId?: string;
  /** Query string that can force the panel on (?instructor=1) or off (?instructor=0). */
  readonly search?: string;
  /** Keeps the steps open: no hide button, and a collapsed choice saved earlier is ignored. */
  readonly alwaysOpen?: boolean;
}

const storeKey = (screen: InstructorScreen): string => `gavel:instructor:${screen}`;

function readCollapsed(screen: InstructorScreen): boolean {
  try {
    const saved = sessionStorage.getItem(storeKey(screen));
    if (saved === 'closed') return true;
    if (saved === 'open') return false;
  } catch {
    // No storage: use the default.
  }
  return false;
}

function writeCollapsed(screen: InstructorScreen, collapsed: boolean): void {
  try {
    sessionStorage.setItem(storeKey(screen), collapsed ? 'closed' : 'open');
  } catch {
    // The choice only lasts for this view.
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
 * A short, collapsible step list at the top of a judge screen: what to do here and what comes
 * next. The current step follows the room, not a button. A region with a heading, not a dialog,
 * so it never covers a control.
 */
export function Instructor({
  screen,
  current = null,
  judge,
  roomId,
  search,
  alwaysOpen = false,
}: InstructorProps) {
  const enabled = instructorEnabled(search ?? window.location.search);
  const isJudge = useIsJudgeRoom(enabled, judge, roomId);
  const [saved, setCollapsed] = useState(() => readCollapsed(screen));
  const collapsed = alwaysOpen ? false : saved;
  const headingId = useId();
  const listId = useId();
  if (!enabled || !isJudge) return null;
  const steps = INSTRUCTOR_STEPS[screen];
  const toggle = (): void => {
    setCollapsed(!collapsed);
    writeCollapsed(screen, !collapsed);
  };
  return (
    <section
      className="gv-instructor"
      role="region"
      aria-labelledby={headingId}
      data-screen={screen}
    >
      <div className="gv-instructor__head">
        <h2 className="gv-instructor__title ui-kicker" id={headingId}>
          {t('instructor.title')}
        </h2>
        {!alwaysOpen && (
          <button
            type="button"
            className="gv-instructor__toggle"
            aria-expanded={!collapsed}
            aria-controls={listId}
            onClick={toggle}
          >
            {collapsed ? t('instructor.show') : t('instructor.hide')}
          </button>
        )}
      </div>
      <div id={listId} hidden={collapsed}>
        <p className="gv-instructor__lead">{t('instructor.lead')}</p>
        <ol className="gv-instructor__steps">
          {steps.map((key, i) => {
            const here = i === current;
            return (
              <li key={key} {...(here ? { 'aria-current': 'step' as const } : {})} data-here={here}>
                {here && <strong className="gv-instructor__now">{t('instructor.now')} </strong>}
                {t(key)}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
