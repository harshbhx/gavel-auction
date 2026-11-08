import { useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { SCRIPTED_DEMO_PATH } from '../../net/scriptedMode';
import { JoinCodeInput } from '../../ui';
import { BlurText, useInView } from '../../ui/fx';
import { MoneyFlow, StatsSection, TechSection } from './LandingExtras';
import {
  AudienceSection,
  DOCS_URL,
  FaqSection,
  FeaturesSection,
  HowSection,
  LICENSE_URL,
  LotCard,
  REPO_URL,
  TrustSection,
} from './LandingSections';
import { lookupProblemText } from '../../net/apiError';
import './landing.css';
import './landing-extra.css';
import { Logo } from '../../design/Logo';

/** default: both actions ready. busy: a room is being created. down: the server is unreachable. */
export type LandingStatus = 'default' | 'busy' | 'down';

export interface LandingScreenProps {
  status?: LandingStatus;
  onStart: () => void;
  /** Resolves true when the code names a room (the caller navigates), false when it does not. */
  onJoin: (code: string) => Promise<boolean>;
  /** Opens the production-safe scripted demo (also offered when the server is down). */
  onScripted: () => void;
}

const CODE_LENGTH = 6;

/** A link that the caller routes in-app; modified clicks keep the browser behaviour. */
function routeClick(go: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go();
  };
}

/** Marketing landing: header, hero, how it works, features, evidence, audiences, FAQ, footer. */
export function LandingScreen({
  status = 'default',
  onStart,
  onJoin,
  onScripted,
}: LandingScreenProps) {
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const busy = status === 'busy';
  const [past, setPast] = useState(false);
  const [finalRef, finalSeen] = useInView<HTMLElement>(false);
  useEffect(() => {
    const onScroll = (): void => setPast(window.scrollY > 520);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed === '' || checking) return;
    setChecking(true);
    onJoin(trimmed)
      .then((found) => {
        setProblem(null);
        setInvalid(!found);
      })
      .catch((error: unknown) => {
        setProblem(lookupProblemText(error));
        setInvalid(true);
      })
      .finally(() => setChecking(false));
  };

  const tryDemo = routeClick(onScripted);

  return (
    <div className="gv-mk">
      <header className="gv-mk-header">
        <div className="gv-mk-header__bar">
          <span className="gv-mk-header__brand">
            <Logo variant="wordmark" height={22} />
          </span>
          <nav className="gv-mk-header__nav" aria-label={t('mk.nav.label')}>
            <a href="#how">{t('mk.nav.how')}</a>
            <a href="#trust">{t('mk.nav.trust')}</a>
            <a href={DOCS_URL}>{t('mk.nav.docs')}</a>
          </nav>
          <a className="gv-cta gv-cta--small" href={SCRIPTED_DEMO_PATH} onClick={tryDemo}>
            {t('mk.cta.try')}
          </a>
        </div>
      </header>
      <main className="gv-landing" id="top">
        <section className="gv-hero" aria-labelledby="hero-title">
          <div className="gv-hero__copy">
            <p className="ui-kicker gv-landing__kicker">{t('mk.hero.kicker')}</p>
            <h1 id="hero-title" className="gv-landing__title">
              <BlurText text={t('landing.title')} />
            </h1>
            <p className="gv-landing__promise">{t('landing.promise')}</p>
            <p className="gv-landing__explain">{t('mk.hero.sub')}</p>
            <div className="gv-landing__actions">
              <a className="gv-cta" href={SCRIPTED_DEMO_PATH} onClick={tryDemo}>
                {t('mk.cta.try')}
              </a>
              <p className="gv-hero__note">{t('mk.hero.demoNote')}</p>
            </div>
            <p className="gv-hero__or">{t('mk.hero.or')}</p>
            <div className="gv-landing__start">
              <Button variant="outline" size="bid" disabled={busy} onClick={onStart}>
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
              <p className="ui-kicker">{t('landing.join')}</p>
              <JoinCodeInput
                value={code}
                length={CODE_LENGTH}
                prefix=""
                disabled={checking}
                invalid={invalid}
                {...(invalid ? { message: problem ?? t('landing.codeInvalid') } : {})}
                onChange={(next) => {
                  setCode(next);
                  setInvalid(false);
                  setProblem(null);
                }}
              />
              <Button type="submit" variant="outline" disabled={checking || code.trim() === ''}>
                {t('landing.join')}
              </Button>
            </form>
          </div>
          <div className="gv-hero__visual">
            <LotCard />
          </div>
        </section>
        <TechSection />
        <HowSection />
        <MoneyFlow />
        <FeaturesSection />
        <StatsSection />
        <TrustSection />
        <AudienceSection />
        <FaqSection />
        <section ref={finalRef} className="gv-final" aria-labelledby="final-title">
          <h2 id="final-title" className="gv-mk-section__title">
            {t('mk.final.title')}
          </h2>
          <p className="gv-landing__explain">{t('mk.final.body')}</p>
          <div className="gv-final__actions">
            <a className="gv-cta" href={SCRIPTED_DEMO_PATH} onClick={tryDemo}>
              {t('mk.cta.try')}
            </a>
            <a className="gv-cta gv-cta--outline" href={DOCS_URL}>
              {t('mk.foot.docs')}
            </a>
          </div>
        </section>
      </main>
      <div
        className="gv-sticky-cta"
        role="group"
        aria-label={t('mk.sticky.label')}
        data-show={past && !finalSeen ? 'true' : 'false'}
      >
        <a className="gv-cta" href={SCRIPTED_DEMO_PATH} onClick={tryDemo}>
          {t('mk.cta.try')}
        </a>
      </div>
      <footer className="gv-mk-footer">
        <div className="gv-mk-footer__inner">
          <div className="gv-mk-footer__intro">
            <p className="gv-mk-footer__brand">
              <Logo variant="wordmark" height={26} />
            </p>
            <p className="gv-mk-footer__tag">{t('mk.foot.tag')}</p>
          </div>
          <nav className="gv-mk-footer__cols" aria-label={t('mk.foot.nav')}>
            <div className="gv-mk-footer__col">
              <p className="ui-kicker">{t('mk.foot.colProduct')}</p>
              <ul className="gv-mk-footer__links">
                <li>
                  <a href={SCRIPTED_DEMO_PATH} onClick={tryDemo}>
                    {t('mk.cta.try')}
                  </a>
                </li>
                <li>
                  <a href="#how">{t('mk.nav.how')}</a>
                </li>
                <li>
                  <a href="#who">{t('mk.aud.title')}</a>
                </li>
                <li>
                  <a href="#faq">{t('mk.faq.title')}</a>
                </li>
              </ul>
            </div>
            <div className="gv-mk-footer__col">
              <p className="ui-kicker">{t('mk.foot.colProject')}</p>
              <ul className="gv-mk-footer__links">
                <li>
                  <a href={REPO_URL}>{t('mk.foot.github')}</a>
                </li>
                <li>
                  <a href={DOCS_URL}>{t('mk.foot.docs')}</a>
                </li>
                <li>
                  <a href={LICENSE_URL}>{t('mk.foot.license')}</a>
                </li>
              </ul>
            </div>
            <div className="gv-mk-footer__col">
              <p className="ui-kicker">{t('mk.foot.colProof')}</p>
              <ul className="gv-mk-footer__links">
                <li>
                  <a href={`${DOCS_URL}/docs/judges/findings-that-mattered`}>
                    {t('mk.foot.findings')}
                  </a>
                </li>
                <li>
                  <a href={`${DOCS_URL}/docs/proof/evidence-map`}>{t('mk.foot.evidence')}</a>
                </li>
              </ul>
            </div>
          </nav>
        </div>
        <p className="gv-mk-footer__note">{t('mk.foot.data')}</p>
        <p className="gv-mk-footer__note">{t('mk.foot.sandbox')}</p>
      </footer>
    </div>
  );
}

export default LandingScreen;
