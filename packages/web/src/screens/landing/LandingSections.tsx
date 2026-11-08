import type { ReactNode } from 'react';
import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Chip, type ChipTone } from '../../design/primitives/Chip';
import { formatUsd } from '../../util/money';
import { PriceRoll } from '../../ui';
import { SpotlightCard } from '../../ui/fx';
import { HammerArt, HoldArt, VoiceArt } from './LandingArt';
import { HowPanel, useActiveStep } from './LandingHow';

export const DOCS_URL = 'https://gavel-docs.creharsh.workers.dev';
export const OPEN_DATA_URL =
  'https://huggingface.co/collections/harshbhx/gavel-evidence-auction-holds-hammer-and-receipts-6af0afebebb37eb4c9184504';
export const REPO_URL = 'https://github.com/harshbhx/gavel-auction';
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/** The example lot in the hero: hatched while held, solid when charged, hollow when released. */
export function LotCard() {
  return (
    <article className="gv-lot" aria-label={t('mk.lot.aria')}>
      <p className="ui-kicker">{t('mk.lot.kicker')}</p>
      <p className="gv-lot__title">{t('mk.lot.title')}</p>
      <ol className="gv-lot__stages">
        <li className="gv-lot__stage" data-state="held">
          <p className="ui-kicker">{t('mk.lot.stageHeld')}</p>
          <div className="gv-lot__row">
            <em className="gv-lot__tag">{t('ui.hold.tagHeld')}</em>
            <PriceRoll cents={50000} />
          </div>
          <div className="ui-holdbar" role="img" aria-label={t('mk.lot.heldText')}>
            <i className="ui-holdbar__held" />
          </div>
          <p className="gv-lot__text">{t('mk.lot.heldText')}</p>
        </li>
        <li className="gv-lot__stage" data-state="charged">
          <p className="ui-kicker">{t('mk.lot.stageWin')}</p>
          <div className="gv-lot__row">
            <em className="gv-lot__tag">{t('ladder.state.CAPTURED')}</em>
            <PriceRoll cents={35000} />
          </div>
          <div className="ui-holdbar" role="img" aria-label={t('mk.lot.winText')}>
            <i className="ui-holdbar__charged" style={{ flex: 350 }} />
            <i className="ui-holdbar__released" style={{ flex: 150 }} />
          </div>
          <p className="gv-lot__text">{t('mk.lot.winText')}</p>
        </li>
        <li className="gv-lot__stage" data-state="released">
          <p className="ui-kicker">{t('mk.lot.stageOut')}</p>
          <div className="gv-lot__row">
            <em className="gv-lot__tag">{t('ui.hold.tagReleased')}</em>
            <PriceRoll cents={50000} />
          </div>
          <div
            className="ui-holdbar"
            role="img"
            aria-label={t('ui.hold.textReleased', { amount: formatUsd(50000) })}
          >
            <i className="ui-holdbar__released ui-holdbar__released--full" />
          </div>
          <p className="gv-lot__text">{t('ui.hold.textReleased', { amount: formatUsd(50000) })}</p>
        </li>
      </ol>
      <p className="gv-lot__note">{t('mk.lot.note')}</p>
    </article>
  );
}

export function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section className="gv-mk-section" id={id} aria-labelledby={`${id}-title`}>
      <div className="gv-mk-section__head gv-reveal">
        <h2 id={`${id}-title`} className="gv-mk-section__title">
          {title}
        </h2>
        {lead !== undefined && <p className="gv-mk-section__lead">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

export function HowSection() {
  const steps = [
    {
      art: <HoldArt />,
      title: t('mk.how.s1.title'),
      body: t('mk.how.s1.body'),
    },
    {
      art: <VoiceArt />,
      title: t('mk.how.s2.title'),
      body: t('mk.how.s2.body'),
    },
    {
      art: <HammerArt />,
      title: t('mk.how.s3.title'),
      body: t('mk.how.s3.body'),
    },
  ];
  const [register, active] = useActiveStep(steps.length);
  const step = (active + 1) as 1 | 2 | 3;
  return (
    <Section id="how" title={t('mk.how.title')} lead={t('mk.how.lead')}>
      <div className="gv-how">
        <ol className="gv-steps">
          {steps.map((s, i) => (
            <li
              key={s.title}
              ref={(el) => register(el, i)}
              className="gv-steps__item gv-reveal"
              data-active={i === active ? 'true' : 'false'}
            >
              {s.art}
              <p className="ui-kicker">{t('mk.how.step', { n: i + 1 })}</p>
              <h3 className="gv-steps__title">{s.title}</h3>
              <p className="gv-steps__body">{s.body}</p>
            </li>
          ))}
        </ol>
        <HowPanel step={step} />
      </div>
    </Section>
  );
}

/** Small decorative drawings for the bento cells. CSS only and hidden from assistive tech. */
function FeatureVisual({ id }: { id: string }) {
  if (id === 'hold') {
    return (
      <div className="gv-vis gv-vis--hold" aria-hidden="true">
        <i className="gv-vis__held" />
        <i className="gv-vis__solid" />
        <i className="gv-vis__hollow" />
      </div>
    );
  }
  if (id === 'voice') {
    return (
      <div className="gv-vis gv-vis--voice" aria-hidden="true">
        {[40, 70, 100, 60, 85, 45, 25].map((h, i) => (
          <i key={i} style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    );
  }
  if (id === 'screen') {
    return (
      <div className="gv-vis gv-vis--screen" aria-hidden="true">
        {[34, 52, 71, 100].map((h, i) => (
          <i key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
    );
  }
  return (
    <div className="gv-vis gv-vis--receipt" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}

export function FeaturesSection() {
  const features = [
    { id: 'hold', title: t('mk.feat.hold.title'), body: t('mk.feat.hold.body') },
    { id: 'voice', title: t('mk.feat.voice.title'), body: t('mk.feat.voice.body') },
    { id: 'screen', title: t('mk.feat.screen.title'), body: t('mk.feat.screen.body') },
    { id: 'receipt', title: t('mk.feat.receipt.title'), body: t('mk.feat.receipt.body') },
  ];
  return (
    <Section id="features" title={t('mk.feat.title')}>
      <ul className="gv-features gv-bento">
        {features.map((f) => (
          <SpotlightCard
            key={f.id}
            as="li"
            className={`gv-features__item gv-bento__cell gv-bento__cell--${f.id} gv-reveal`}
          >
            <h3 className="gv-features__title">{f.title}</h3>
            <p className="gv-features__body">{f.body}</p>
            <FeatureVisual id={f.id} />
          </SpotlightCard>
        ))}
      </ul>
    </Section>
  );
}

interface TrustItem {
  title: string;
  body: string;
  status: string;
  tone: ChipTone;
  icon: 'check' | 'clock' | 'warning' | 'hollow';
  href: string;
}

export function TrustSection() {
  const items: TrustItem[] = [
    {
      title: t('mk.trust.g0.title'),
      body: t('mk.trust.g0.body'),
      status: t('mk.trust.passed'),
      tone: 'success',
      icon: 'check',
      href: `${DOCS_URL}/docs/proof/gate-g0`,
    },
    {
      title: t('mk.trust.g1.title'),
      body: t('mk.trust.g1.body'),
      status: t('mk.trust.passed'),
      tone: 'success',
      icon: 'check',
      href: `${DOCS_URL}/docs/proof/gate-g1`,
    },
    {
      title: t('mk.trust.g2.title'),
      body: t('mk.trust.g2.body'),
      status: t('mk.trust.passed'),
      tone: 'success',
      icon: 'check',
      href: `${DOCS_URL}/docs/proof/gate-g2`,
    },
    {
      title: t('mk.trust.g3.title'),
      body: t('mk.trust.g3.body'),
      status: t('mk.trust.progress'),
      tone: 'neutral',
      icon: 'clock',
      href: `${DOCS_URL}/docs/proof/gate-g3`,
    },
    {
      title: t('mk.trust.g4.title'),
      body: t('mk.trust.g4.body'),
      status: t('mk.trust.passed'),
      tone: 'success',
      icon: 'check',
      href: `${DOCS_URL}/docs/proof/gate-g4`,
    },
    {
      title: t('mk.trust.g5.title'),
      body: t('mk.trust.g5.body'),
      status: t('mk.trust.partial'),
      tone: 'warning',
      icon: 'warning',
      href: `${DOCS_URL}/docs/proof/gate-g5`,
    },
    {
      title: t('mk.trust.sim.title'),
      body: t('mk.trust.sim.body'),
      status: t('mk.trust.simulated'),
      tone: 'neutral',
      icon: 'hollow',
      href: `${DOCS_URL}/docs/proof/evidence-map`,
    },
    {
      title: t('mk.trust.lat.title'),
      body: t('mk.trust.lat.body'),
      status: t('mk.trust.partial'),
      tone: 'warning',
      icon: 'warning',
      href: `${DOCS_URL}/docs/proof/evidence-map`,
    },
  ];
  return (
    <Section id="trust" title={t('mk.trust.title')} lead={t('mk.trust.lead')}>
      <ul className="gv-trust">
        {items.map((it) => (
          <li key={it.title} className="gv-trust__item gv-reveal">
            <Chip
              state={it.status}
              label={it.status}
              tone={it.tone}
              icon={<Icon name={it.icon} />}
            />
            <h3 className="gv-trust__title">{it.title}</h3>
            <p className="gv-trust__body">{it.body}</p>
            <a className="gv-link" href={it.href}>
              {t('mk.trust.read')}
              <span className="gv-visually-hidden"> {it.title}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="gv-trust__note">{t('mk.trust.note')}</p>
    </Section>
  );
}

export function AudienceSection() {
  return (
    <Section id="who" title={t('mk.aud.title')}>
      <div className="gv-aud">
        <SpotlightCard as="article" className="gv-aud__col gv-reveal">
          <h3 className="gv-aud__title">{t('mk.aud.sel.title')}</h3>
          <p>{t('mk.aud.sel.body')}</p>
        </SpotlightCard>
        <SpotlightCard as="article" className="gv-aud__col gv-reveal">
          <h3 className="gv-aud__title">{t('mk.aud.auc.title')}</h3>
          <p>{t('mk.aud.auc.body')}</p>
        </SpotlightCard>
        <SpotlightCard as="article" className="gv-aud__col gv-reveal">
          <h3 className="gv-aud__title">{t('mk.aud.bid.title')}</h3>
          <p>{t('mk.aud.bid.body')}</p>
        </SpotlightCard>
      </div>
    </Section>
  );
}

export function FaqSection() {
  const faqs = [
    { q: t('mk.faq.q1'), a: t('mk.faq.a1') },
    { q: t('mk.faq.q2'), a: t('mk.faq.a2') },
    { q: t('mk.faq.q3'), a: t('mk.faq.a3') },
    { q: t('mk.faq.q4'), a: t('mk.faq.a4') },
    { q: t('mk.faq.q5'), a: t('mk.faq.a5') },
    { q: t('mk.faq.q6'), a: t('mk.faq.a6') },
    { q: t('mk.faq.q7'), a: t('mk.faq.a7') },
    { q: t('mk.faq.q8'), a: t('mk.faq.a8') },
  ];
  return (
    <Section id="faq" title={t('mk.faq.title')}>
      <div className="gv-faq">
        {faqs.map((f) => (
          <details key={f.q} className="gv-faq__item">
            <summary className="gv-faq__q">{f.q}</summary>
            <p className="gv-faq__a">{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
