import { formatUsd } from '../util/money';

/** Splits a formatted amount into one entry per character, so each digit can roll on its own. */
export function priceChars(cents: number): string[] {
  return [...formatUsd(cents)];
}

/** Indexes of the characters that differ between two amounts; all of them when the length changes. */
export function changedIndexes(from: number, to: number): number[] {
  const a = priceChars(from);
  const b = priceChars(to);
  if (a.length !== b.length) return b.map((_, i) => i);
  return b.flatMap((ch, i) => (ch === a[i] ? [] : [i]));
}

/** Clamps to [min, max] and snaps to the nearest step counted from min. */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, snapped);
}

/** True when the user asks for reduced motion. Safe where matchMedia is missing. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A receipt time in the viewer's locale and zone, with the zone name ("14 Nov 2023, 22:13 UTC"). */
export function formatTime(at: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(at));
}

/** The same instant in UTC, for the title and the accessible name. */
export function formatTimeUtc(at: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(at));
}
