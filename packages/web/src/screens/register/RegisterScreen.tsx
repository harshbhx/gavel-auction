import { useState, type FormEvent } from 'react';

import { WideAside } from '../WideAside';
import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { FakePaymentsLabel } from '../../design/FakePaymentsLabel';
import { Icon } from '../../design/icons';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import { formatUsdCompact } from '../../util/money';
import { CeilingSlider, HoldButton } from '../../ui';
import '../flows.css';
import { customCeilingCents, nameHasForbidden, parseWholeDollars, validName } from './validate';

export interface RegistrationDraft {
  name: string;
  ceilingCents: number;
}

export interface RegisterScreenProps {
  /** Room minimum and maximum cap (room.config.maxCeilingCents), in cents. */
  minCents: number;
  maxCents: number;
  presetsCents?: readonly number[];
  /** False when the room takes only its presets: the Custom option and its range hint are left out. */
  allowCustom?: boolean;
  /** What the bidder entered before going back from the approval step; shown again as typed. */
  initial?: RegistrationDraft;
  onApprove: (draft: RegistrationDraft) => void;
}

const DEFAULT_PRESETS: readonly number[] = [10000, 25000, 50000, 100000];
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

/** Registration steps 1 and 2 (R-WEB-040..042, R-WEB-116). */
export function RegisterScreen({
  minCents,
  maxCents,
  presetsCents = DEFAULT_PRESETS,
  allowCustom = true,
  initial,
  onApprove,
}: RegisterScreenProps) {
  const initialPreset = initial !== undefined && presetsCents.includes(initial.ceilingCents);
  const initialChoice =
    initial === undefined
      ? null
      : initialPreset
        ? String(initial.ceilingCents)
        : allowCustom
          ? CUSTOM
          : null;
  const [step, setStep] = useState<1 | 2>(initial === undefined ? 1 : 2);
  const [name, setName] = useState(initial?.name ?? '');
  const [touched, setTouched] = useState(false);
  const [choice, setChoice] = useState<string | null>(initialChoice);
  const [customText, setCustomText] = useState(
    initial === undefined || initialPreset ? '' : String(initial.ceilingCents / 100),
  );
  const [customTouched, setCustomTouched] = useState(false);
  const typedInitial = parseWholeDollars(customText);
  const [rangeMax, setRangeMax] = useState(() =>
    sliderMax(minCents, maxCents, presetsCents, typedInitial),
  );

  const nameOk = validName(name);
  const stepOneValid = nameOk;

  const nameError =
    touched && !nameOk
      ? t(nameHasForbidden(name) ? 'reg.nameInvalid' : 'generic.error')
      : undefined;

  const customCents = customCeilingCents(customText, minCents, maxCents);
  let ceilingCents: number | null = null;
  if (choice === CUSTOM) ceilingCents = customCents;
  else if (choice !== null) ceilingCents = Number(choice);
  const typedCents = parseWholeDollars(customText);
  const overCap = typedCents !== null && typedCents > maxCents;
  const customError =
    choice === CUSTOM && (customTouched || overCap) && customCents === null
      ? overCap
        ? t('reg.overCap', { max: formatUsdCompact(maxCents) })
        : t('reg.customRange', { min: formatUsdCompact(minCents), max: formatUsdCompact(maxCents) })
      : undefined;

  const submitStepOne = (e: FormEvent): void => {
    e.preventDefault();
    setTouched(true);
    if (stepOneValid) {
      setStep(2);
      return;
    }
    announce('assertive', t(nameHasForbidden(name) ? 'reg.nameInvalid' : 'generic.error'));
  };

  /** Checks the ceiling; the amount is sent only after the hold (or its two-tap alternative). */
  const confirmStepTwo = (): void => {
    setCustomTouched(true);
    if (ceilingCents === null) {
      if (!allowCustom) return;
      announce(
        'assertive',
        customError ??
          t('reg.customRange', {
            min: formatUsdCompact(minCents),
            max: formatUsdCompact(maxCents),
          }),
      );
      return;
    }
    onApprove({ name: name.trim(), ceilingCents });
  };

  const submitStepTwo = (e: FormEvent): void => {
    e.preventDefault();
    setCustomTouched(true);
  };

  const pickFromSlider = (cents: number): void => {
    setChoice(presetsCents.includes(cents) ? String(cents) : CUSTOM);
    setCustomText(String(cents / 100));
    setCustomTouched(false);
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

  if (step === 1) {
    return (
      <main className="gv-flow" data-step="name">
        <h1 tabIndex={-1}>{t('reg.step1')}</h1>
        <form onSubmit={submitStepOne} noValidate>
          <Field
            label={t('reg.name')}
            hint={t('reg.nameHint')}
            value={name}
            maxLength={64}
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            {...(nameError === undefined ? {} : { error: nameError })}
          />
          <Button type="submit" size="bid" disabled={!stepOneValid}>
            {t('reg.continue')}
          </Button>
        </form>
        <WideAside />
      </main>
    );
  }

  return (
    <main className="gv-flow" data-step="ceiling">
      <h1 tabIndex={-1}>{t('reg.step2')}</h1>
      <p className="gv-flow__summary">{t('reg.summary', { name: name.trim() })}</p>
      <form onSubmit={submitStepTwo} noValidate>
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
                  setCustomTouched(false);
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
            onBlur={() => setCustomTouched(true)}
            {...(customError === undefined ? {} : { error: customError })}
          />
        )}
        {ceilingCents !== null && (
          <section className="gv-flow__held" data-testid="held-block">
            <p>
              <Icon name="lock" />
              <strong>{t('reg.heldNotCharged')}</strong>
            </p>
            <p>{t('reg.heldExplain', { amount: formatUsdCompact(ceilingCents) })}</p>
            <p>{t('reg.holdIsNotPayment')}</p>
          </section>
        )}
        <FakePaymentsLabel />
        <HoldButton
          key={ceilingCents ?? 'none'}
          label={t('reg.approve')}
          disabled={ceilingCents === null}
          onConfirm={confirmStepTwo}
        />
      </form>
      <WideAside />
    </main>
  );
}
