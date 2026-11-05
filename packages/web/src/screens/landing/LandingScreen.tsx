import { useState, type FormEvent } from 'react';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';

/** default: both actions ready. busy: a room is being created. down: the server is unreachable. */
export type LandingStatus = 'default' | 'busy' | 'down';

export interface LandingScreenProps {
  status?: LandingStatus;
  onStart: () => void;
  /** Resolves true when the code names a room (the caller navigates), false when it does not. */
  onJoin: (code: string) => Promise<boolean>;
  /** Offered when the server is down: runs the scripted demo instead. */
  onScripted: () => void;
}

/** Landing: one-sentence product, the held-not-charged promise and two actions (R-WEB-035). */
export function LandingScreen({
  status = 'default',
  onStart,
  onJoin,
  onScripted,
}: LandingScreenProps) {
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [checking, setChecking] = useState(false);
  const busy = status === 'busy';

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed === '' || checking) return;
    setChecking(true);
    onJoin(trimmed)
      .then((found) => setInvalid(!found))
      .catch(() => setInvalid(true))
      .finally(() => setChecking(false));
  };

  return (
    <main className="gv-landing">
      <h1>{t('landing.title')}</h1>
      <p className="gv-landing__promise">{t('landing.promise')}</p>
      <p>{t('landing.explain')}</p>
      <div className="gv-landing__actions">
        <Button size="bid" disabled={busy} onClick={onStart}>
          {busy ? t('demo.creating') : t('landing.start')}
        </Button>
      </div>
      {status === 'down' && (
        <div role="alert" className="gv-landing__down">
          <p>{t('demo.failed')}</p>
          <Button variant="outline" onClick={onScripted}>
            {t('demo.scriptedInstead')}
          </Button>
        </div>
      )}
      <form className="gv-landing__join" onSubmit={submit}>
        <Field
          label={t('landing.join')}
          value={code}
          autoComplete="off"
          onChange={(e) => {
            setCode(e.target.value);
            setInvalid(false);
          }}
          {...(invalid ? { error: t('landing.codeInvalid') } : {})}
        />
        <Button type="submit" variant="outline" disabled={checking || code.trim() === ''}>
          {t('landing.join')}
        </Button>
      </form>
    </main>
  );
}

export default LandingScreen;
