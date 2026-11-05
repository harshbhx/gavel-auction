import { useState, type FormEvent } from 'react';

import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import { formatUsdCompact } from '../../util/money';
import { customCeilingCents, parsePaddle, validName } from './validate';

export interface RegistrationDraft {
  name: string;
  paddle: number;
  ceilingCents: number;
}

export interface RegisterScreenProps {
  /** Paddle the server suggested; the bidder may edit it. */
  suggestedPaddle: number;
  /** Set when the server rejected a paddle as taken, with the number it suggests instead. */
  paddleTaken?: { taken: number; suggested: number };
  /** Room minimum and maximum cap (room.config.maxCeilingCents), in cents. */
  minCents: number;
  maxCents: number;
  presetsCents?: readonly number[];
  onApprove: (draft: RegistrationDraft) => void;
}

const DEFAULT_PRESETS: readonly number[] = [10000, 25000, 50000, 100000];
const CUSTOM = 'custom';

/** Registration steps 1 and 2 (R-WEB-040..042, R-WEB-116). */
export function RegisterScreen({
  suggestedPaddle,
  paddleTaken,
  minCents,
  maxCents,
  presetsCents = DEFAULT_PRESETS,
  onApprove,
}: RegisterScreenProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [paddleText, setPaddleText] = useState(String(suggestedPaddle));
  const [touched, setTouched] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [customTouched, setCustomTouched] = useState(false);

  const paddle = parsePaddle(paddleText);
  const takenHit = paddleTaken !== undefined && paddle === paddleTaken.taken;
  const nameOk = validName(name);
  const paddleOk = paddle !== null && !takenHit;
  const stepOneValid = nameOk && paddleOk;

  const nameError = touched && !nameOk ? t('generic.error') : undefined;
  let paddleError: string | undefined;
  if (paddleTaken !== undefined && takenHit) {
    paddleError = t('reg.paddleTaken', { n: paddleTaken.taken, m: paddleTaken.suggested });
  } else if (touched && paddle === null) {
    paddleError = t('generic.error');
  }

  const customCents = customCeilingCents(customText, minCents, maxCents);
  let ceilingCents: number | null = null;
  if (choice === CUSTOM) ceilingCents = customCents;
  else if (choice !== null) ceilingCents = Number(choice);
  const customError =
    choice === CUSTOM && customTouched && customCents === null
      ? t('reg.customRange', { min: formatUsdCompact(minCents), max: formatUsdCompact(maxCents) })
      : undefined;

  const submitStepOne = (e: FormEvent): void => {
    e.preventDefault();
    setTouched(true);
    if (stepOneValid) {
      setStep(2);
      return;
    }
    announce('assertive', paddleError ?? t('generic.error'));
  };

  const submitStepTwo = (e: FormEvent): void => {
    e.preventDefault();
    setCustomTouched(true);
    if (ceilingCents === null || paddle === null) {
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
    onApprove({ name: name.trim(), paddle, ceilingCents });
  };

  if (step === 1) {
    return (
      <main>
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
          <Field
            label={t('reg.paddle')}
            value={paddleText}
            inputMode="numeric"
            onChange={(e) => setPaddleText(e.target.value)}
            onBlur={() => setTouched(true)}
            {...(paddleError === undefined ? {} : { error: paddleError })}
          />
          <Button type="submit" size="bid" disabled={!stepOneValid}>
            {t('reg.continue')}
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main>
      <h1 tabIndex={-1}>{t('reg.step2')}</h1>
      <form onSubmit={submitStepTwo} noValidate>
        <div role="radiogroup" aria-label={t('reg.step2')}>
          {presetsCents.map((cents) => (
            <label key={cents}>
              <input
                type="radio"
                name="ceiling"
                checked={choice === String(cents)}
                onChange={() => setChoice(String(cents))}
              />
              <span>{formatUsdCompact(cents)}</span>
            </label>
          ))}
          <label>
            <input
              type="radio"
              name="ceiling"
              checked={choice === CUSTOM}
              onChange={() => setChoice(CUSTOM)}
            />
            <span>{t('reg.custom')}</span>
          </label>
        </div>
        {choice === CUSTOM && (
          <Field
            label={t('reg.custom')}
            value={customText}
            inputMode="numeric"
            onChange={(e) => setCustomText(e.target.value)}
            onBlur={() => setCustomTouched(true)}
            {...(customError === undefined ? {} : { error: customError })}
          />
        )}
        {ceilingCents !== null && (
          <section data-testid="held-block">
            <p>
              <Icon name="lock" />
              <strong>{t('reg.heldNotCharged')}</strong>
            </p>
            <p>{t('reg.heldExplain', { amount: formatUsdCompact(ceilingCents) })}</p>
            <p>{t('reg.holdIsNotPayment')}</p>
          </section>
        )}
        <Button type="submit" size="bid" disabled={ceilingCents === null}>
          {t('reg.approve')}
        </Button>
      </form>
    </main>
  );
}
