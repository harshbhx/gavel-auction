import { useState } from 'react';

import { t } from '../../copy/t';
import { Field } from '../../design/primitives/Field';
import { CeilingSlider } from '../../ui';
import { formatUsdCompact } from '../../util/money';
import { customCeilingCents, parseWholeDollars } from './validate';

const CUSTOM = 'custom';
/** The slider's usual top ($10,000); a typed limit above it stretches it up to the server cap. */
const DEFAULT_SLIDER_MAX_CENTS = 1_000_000;
const STEP_CHOICES: readonly number[] = [
  1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000,
  10000000,
];
const MAX_TICKS = 24;

/** The smallest round step that keeps the slider to a readable number of ticks. */
export function sliderStep(minCents: number, maxCents: number): number {
  const span = Math.max(1, maxCents - minCents);
  return (
    STEP_CHOICES.find((s) => span / s <= MAX_TICKS) ??
    STEP_CHOICES[STEP_CHOICES.length - 1] ??
    10000000
  );
}

/** Whole dollars with thousands separators ("2,500"); empty text stays empty. */
export function formatDigits(digits: string): string {
  return digits === '' ? '' : Number(digits).toLocaleString('en-US');
}

const NICE_MANTISSAS: readonly number[] = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];

/** The next clean amount at or above `cents` (1, 1.5, 2, 2.5, 3, 4, 5, 7.5 times a power of ten). */
export function niceCeil(cents: number): number {
  if (cents <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(cents));
  const m = NICE_MANTISSAS.find((x) => x * pow >= cents - 1e-9) ?? 10;
  return Math.round(m * pow);
}

/**
 * The slider's top: its usual span, stretched to the typed limit and rounded up to a clean
 * amount, never past the server cap. It follows the typed value both ways, so lowering the
 * limit shrinks the range back down to the usual span.
 */
export function sliderMax(
  minCents: number,
  maxCents: number,
  presetsCents: readonly number[],
  typedCents: number | null,
): number {
  // A default range worth sliding: $10,000, or twice the minimum when that is higher (a raise
  // starts just above the current limit), so the slider never collapses to a sliver.
  const base = Math.max(niceCeil(minCents * 2), DEFAULT_SLIDER_MAX_CENTS, ...presetsCents);
  const want = typedCents === null || typedCents <= base ? base : niceCeil(typedCents);
  return Math.min(maxCents, want);
}

const SCALED_FRACTIONS: readonly number[] = [0.25, 0.5, 0.75];

/**
 * Quick picks that follow a big typed limit: a quarter, half and three quarters of it in whole
 * dollars. They appear only once the typed limit is above every preset and within the cap, stay
 * inside the allowed range and never repeat a preset or each other.
 */
export function scaledPicks(
  minCents: number,
  maxCents: number,
  presetsCents: readonly number[],
  anchorCents: number | null,
): number[] {
  if (anchorCents === null || anchorCents > maxCents || anchorCents < minCents) return [];
  if (anchorCents <= Math.max(0, ...presetsCents)) return [];
  const out = new Set<number>();
  for (const f of SCALED_FRACTIONS) {
    const cents = Math.round((anchorCents * f) / 100) * 100;
    if (cents >= minCents && cents < anchorCents && !presetsCents.includes(cents)) out.add(cents);
  }
  return [...out].sort((a, b) => a - b);
}

export interface LimitEntryOptions {
  /** Smallest limit the entry accepts, in cents. */
  minCents: number;
  /** The real cap (room snapshot `maxCeilingCents`), in cents. */
  maxCents: number;
  presetsCents: readonly number[];
  /** False when the room takes only its presets: the number box and the slider are left out. */
  allowCustom: boolean;
  /** A limit chosen earlier, shown again as typed. */
  initialCents?: number | undefined;
}

export interface LimitEntryState {
  /** The chosen limit, or null while nothing valid is chosen. */
  ceilingCents: number | null;
  /** Text for the number box when it holds something the room refuses; undefined when fine. */
  error: string | undefined;
  /** Shows the range error even if the box was not left yet (call on submit). */
  touch: () => void;
  /** The same range text the error uses when no better one exists, for a live announcement. */
  rangeText: string;
  /** The slider, preset chips and number box, bound to this state. */
  fields: JSX.Element;
}

/**
 * The limit control of the register screen and the raise screen: a number box, a slider that
 * follows it and the preset quick picks, all bound to one value. The two screens share it so a
 * limit is entered the same way everywhere (FEAT-61).
 */
export function useLimitEntry(opts: LimitEntryOptions): LimitEntryState {
  const { minCents, maxCents, presetsCents, allowCustom, initialCents } = opts;
  const initialPreset = initialCents !== undefined && presetsCents.includes(initialCents);
  const [choice, setChoice] = useState<string | null>(
    initialCents === undefined
      ? null
      : initialPreset
        ? String(initialCents)
        : allowCustom
          ? CUSTOM
          : null,
  );
  const [customText, setCustomText] = useState(
    initialCents === undefined || initialPreset ? '' : String(initialCents / 100),
  );
  const [touched, setTouched] = useState(false);
  // The widest limit typed so far stretches the slider; the bounds themselves come from the
  // props on every render, so a room snapshot that arrives later is followed (no stale range).
  const [stretchCents, setStretchCents] = useState<number | null>(() =>
    parseWholeDollars(customText),
  );
  const rangeMax = sliderMax(minCents, maxCents, presetsCents, stretchCents);

  const scaled = allowCustom ? scaledPicks(minCents, maxCents, presetsCents, stretchCents) : [];

  const customCents = customCeilingCents(customText, minCents, maxCents);
  let ceilingCents: number | null = null;
  if (choice === CUSTOM) ceilingCents = customCents;
  else if (choice !== null) ceilingCents = Number(choice);
  const typedCents = parseWholeDollars(customText);
  const overCap = typedCents !== null && typedCents > maxCents;
  const rangeText = t('reg.customRange', {
    min: formatUsdCompact(minCents),
    max: formatUsdCompact(maxCents),
  });
  const error =
    choice === CUSTOM && (touched || overCap) && customCents === null
      ? overCap
        ? t('reg.overCap', { max: formatUsdCompact(maxCents) })
        : rangeText
      : undefined;

  const pickFromSlider = (cents: number): void => {
    setChoice(presetsCents.includes(cents) ? String(cents) : CUSTOM);
    setCustomText(String(cents / 100));
    setTouched(false);
  };

  const typeLimit = (raw: string): void => {
    const digits = raw
      .replace(/\D/g, '')
      .replace(/^0+(?=\d)/, '')
      .slice(0, 9);
    setCustomText(digits);
    const cents = parseWholeDollars(digits);
    setChoice(presetsCents.includes(cents ?? -1) ? String(cents) : CUSTOM);
    setStretchCents(cents);
  };

  const fields = (
    <>
      {allowCustom && (
        <CeilingSlider
          value={ceilingCents ?? (overCap ? rangeMax : minCents)}
          min={minCents}
          max={rangeMax}
          step={sliderStep(minCents, rangeMax)}
          marks={presetsCents}
          onChange={pickFromSlider}
        />
      )}
      <div className="gv-chips" role="radiogroup" aria-label={t('reg.step2')}>
        {presetsCents.map((cents) => (
          <label key={cents}>
            <input
              type="radio"
              name="ceiling"
              checked={choice === String(cents)}
              onChange={() => {
                setChoice(String(cents));
                setCustomText(String(cents / 100));
                setTouched(false);
              }}
            />
            <span>{formatUsdCompact(cents)}</span>
          </label>
        ))}
        {scaled.map((cents) => (
          <label key={`scaled-${cents}`}>
            <input
              type="radio"
              name="ceiling"
              checked={choice === CUSTOM && customText === String(cents / 100)}
              onChange={() => {
                setChoice(CUSTOM);
                setCustomText(String(cents / 100));
                setTouched(false);
              }}
            />
            <span>{formatUsdCompact(cents)}</span>
          </label>
        ))}
      </div>
      {allowCustom && (
        <Field
          label={t('reg.custom')}
          value={formatDigits(customText)}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          hint={t('reg.customHint', {
            min: formatUsdCompact(minCents),
            max: formatUsdCompact(maxCents),
          })}
          onChange={(e) => typeLimit(e.target.value)}
          onBlur={() => setTouched(true)}
          {...(error === undefined ? {} : { error })}
        />
      )}
    </>
  );

  return { ceilingCents, error, touch: () => setTouched(true), rangeText, fields };
}
