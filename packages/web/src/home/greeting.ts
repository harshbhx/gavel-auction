import { t } from '../copy/t';
import type { HistoryRoom } from './history';

export interface Greeting {
  /** The headline: who is welcome back. */
  readonly hello: string;
}

/** Picks the headline from the last room: the name first, then the paddle, then plain. */
export function pickGreeting(last: Pick<HistoryRoom, 'name' | 'paddle'> | null): Greeting {
  const name = last?.name ?? null;
  const paddle = last?.paddle ?? null;
  const hello =
    name !== null
      ? t('home.hello.name', { name })
      : paddle !== null
        ? t('home.hello.paddle', { paddle })
        : t('home.hello.plain');
  return { hello };
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
