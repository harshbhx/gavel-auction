import { useState } from 'react';

import { t } from '../../copy/t';
import { Field } from '../../design/primitives/Field';
import { CeilingSlider } from '../../ui';
import { formatUsdCompact } from '../../util/money';
import { customCeilingCents, parseWholeDollars } from './validate';

const CUSTOM = 'custom';
/** The slider's usual span; a typed limit above it stretches the slider up to the server cap. */
const DEFAULT_SLIDER_MAX_CENTS = 100000;
const STEP_CHOICES: readonly number[] = [1000, 2500, 5000, 10000, 25000, 50000, 100000];
const MAX_TICKS = 24;

/** The smallest round step that keeps the slider to a readable number of ticks. */
export function sliderStep(minCents: number, maxCents: number): number {
  const span = Math.max(1, maxCents - minCents);
  return (
    STEP_CHOICES.find((s) => span / s <= MAX_TICKS) ??
    STEP_CHOICES[STEP_CHOICES.length - 1] ??
    100000
  );
}

/** Whole dollars with thousands separators ("2,500"); empty text stays empty. */
export function formatDigits(digits: string): string {
  return digits === '' ? '' : Number(digits).toLocaleString('en-US');
}

/** The slider's top: its usual span, stretched to a typed limit, never past the server cap. */
export function sliderMax(
  minCents: number,
  maxCents: number,
  presetsCents: readonly number[],
  typedCents: number | null,
): number {
  const base = Math.max(minCents, DEFAULT_SLIDER_MAX_CENTS, ...presetsCents);
  return Math.min(maxCents, Math.max(base, typedCents ?? 0));
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
  const [rangeMax, setRangeMax] = useState(() =>
    sliderMax(minCents, maxCents, presetsCents, parseWholeDollars(customText)),
  );

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
    setRangeMax(sliderMax(minCents, maxCents, presetsCents, cents));
  };

  const fields = (
    <>
      {allowCustom && (
        <CeilingSlider
          value={ceilingCents ?? minCents}
          min={minCents}
          max={rangeMax}
          step={sliderStep(minCents, rangeMax)}
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
