import { useEffect, useRef } from 'react';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';

export interface TryScreenProps {
  /** Opens the demo launcher, which starts a real room when the host offers one. */
  readonly onStart: () => void;
}

const STEPS = [
  { title: 'try.step1.title', body: 'try.step1.body' },
  { title: 'try.step2.title', body: 'try.step2.body' },
  { title: 'try.step3.title', body: 'try.step3.body' },
  { title: 'try.step4.title', body: 'try.step4.body' },
] as const;

/** The two-minute path for a judge: start a room, invite a bidder, approve a sandbox hold. */
export function TryScreen({ onStart }: TryScreenProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = t('try.title');
    heading.current?.focus();
  }, []);
  return (
    <main className="gv-demo" data-route="try">
      <h1 ref={heading} tabIndex={-1}>
        {t('try.title')}
      </h1>
      <p>{t('try.lead')}</p>
      <ol>
        {STEPS.map((step) => (
          <li key={step.title}>
            <h2>{t(step.title)}</h2>
            <p>{t(step.body)}</p>
          </li>
        ))}
      </ol>
      <Button size="bid" onClick={onStart}>
        {t('landing.start')}
      </Button>
      <section aria-label={t('try.credsTitle')}>
        <h2>{t('try.credsTitle')}</h2>
        <p>{t('try.credsBody')}</p>
      </section>
      <section aria-label={t('try.expectTitle')}>
        <h2>{t('try.expectTitle')}</h2>
        <p>{t('try.expectBody')}</p>
        <p>{t('try.limits')}</p>
      </section>
      <section aria-label={t('try.tourTitle')}>
        <h2>{t('try.tourTitle')}</h2>
        <p>{t('try.tourBody')}</p>
        <a href="/r/demo/screen?scripted=1">{t('try.tourLink')}</a>
      </section>
    </main>
  );
}

export default TryScreen;
