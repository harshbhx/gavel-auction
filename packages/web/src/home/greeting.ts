import { t } from '../copy/t';
import type { HistoryResult, HistoryRoom } from './history';

export type DayPart = 'night' | 'morning' | 'afternoon' | 'evening';

/** The part of the day in the visitor's own clock. */
export function dayPart(now: number): DayPart {
  const hour = new Date(now).getHours();
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export interface Greeting {
  /** The headline: who is welcome back. */
  readonly hello: string;
  /** The line under it, chosen by the time of day and how the last auction ended. */
  readonly sub: string;
}

/**
 * Picks the two greeting lines from the time of day and the last room. `result` is what the room
 * counts as now: an open room past its life is closed, so the line never says a lot is waiting
 * when the room is gone.
 */
export function pickGreeting(
  last: Pick<HistoryRoom, 'name' | 'paddle'> | null,
  result: HistoryResult,
  now: number,
): Greeting {
  const name = last?.name ?? null;
  const paddle = last?.paddle ?? null;
  const hello =
    name !== null
      ? t('home.hello.name', { name })
      : paddle !== null
        ? t('home.hello.paddle', { paddle })
        : t('home.hello.plain');
  const salutes: Record<DayPart, string> = {
    night: t('home.salute.night'),
    morning: t('home.salute.morning'),
    afternoon: t('home.salute.afternoon'),
    evening: t('home.salute.evening'),
  };
  const salute = salutes[dayPart(now)];
  const sub =
    result === 'open'
      ? t('home.sub.open', { salute })
      : result === 'won'
        ? t('home.sub.won', { salute })
        : t('home.sub.again', { salute });
  return { hello, sub };
}

/** "2 hours ago", in the catalog's words. Future times (a clock that moved back) read as just now. */
export function timeAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return t('home.ago.now');
  if (minutes < 60) {
    return minutes === 1 ? t('home.ago.minute') : t('home.ago.minutes', { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? t('home.ago.hour') : t('home.ago.hours', { n: hours });
  const days = Math.floor(hours / 24);
  return days === 1 ? t('home.ago.day') : t('home.ago.days', { n: days });
}
