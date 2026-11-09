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

/**
 * The positions a slider can rest on: the minimum, every multiple of `step` between the ends
 * (counted from zero, so a ladder reads round whatever the minimum is), any extra `marks` inside
 * the range, and the maximum. Sorted, no duplicates.
 */
export function sliderStops(
  min: number,
  max: number,
  step: number,
  marks: readonly number[] = [],
): number[] {
  const set = new Set<number>([min, max]);
  if (step > 0) {
    for (let v = Math.ceil(min / step) * step; v < max; v += step) set.add(v);
  }
  for (const m of marks) if (m >= min && m <= max) set.add(m);
  return [...set].sort((a, b) => a - b);
}

/** The stop nearest to `value` (the lower one on a tie). */
export function nearestStop(stops: readonly number[], value: number): number {
  let best = stops[0] ?? value;
  for (const s of stops) if (Math.abs(s - value) < Math.abs(best - value)) best = s;
  return best;
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
