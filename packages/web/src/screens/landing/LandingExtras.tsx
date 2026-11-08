import type { CSSProperties } from 'react';
import { t } from '../../copy/t';
import { Marquee, NumberTicker, useInView, useReducedMotion } from '../../ui/fx';
import { DOCS_URL, Section } from './LandingSections';

/** Plain text chips of the technology the project really uses. No logos, no partner claims. */
const TECH: readonly string[] = [
  'PayPal sandbox',
  'Deepgram',
  'Groq',
  'Cloudflare',
  'Render',
  'Fumadocs',
  'React',
  'TypeScript',
];

export function TechSection() {
  return (
    <section className="gv-tech" aria-labelledby="tech-title">
      <h2 id="tech-title" className="ui-kicker gv-tech__title">
        {t('mk.tech.title')}
      </h2>
      <Marquee items={TECH} label={t('mk.tech.label')} />
    </section>
  );
}

/** Real figures only. Each number is sourced in docs/GATES.md, the README or the findings page. */
const FIGURES: readonly { value: number; key: 'red' | 'fixed' | 'lots' | 'holds' | 'tests' }[] = [
  { value: 606, key: 'red' },
  { value: 589, key: 'fixed' },
  { value: 40, key: 'lots' },
  { value: 294, key: 'holds' },
  { value: 568, key: 'tests' },
];

const FIGURE_LABEL = {
  red: 'mk.stat.red',
  fixed: 'mk.stat.fixed',
  lots: 'mk.stat.lots',
  holds: 'mk.stat.holds',
  tests: 'mk.stat.tests',
} as const;

export function StatsSection() {
  return (
    <Section id="numbers" title={t('mk.stat.title')}>
      <dl className="gv-stats">
        {FIGURES.map((f) => (
          <div key={f.key} className="gv-stats__item gv-reveal">
            <dt className="gv-stats__label">{t(FIGURE_LABEL[f.key])}</dt>
            <dd className="gv-stats__num">
              <NumberTicker value={f.value} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="gv-stats__note">
        {t('mk.stat.note')}{' '}
        <a className="gv-link" href={`${DOCS_URL}/docs/judges/findings-that-mattered`}>
          {t('mk.stat.link')}
        </a>
      </p>
    </Section>
  );
}

/**
 * Money flow drawn in inline SVG: a hatched hold, an arrow, the solid amount taken and the hollow
 * rest that is released. The bars appear in turn when the figure scrolls into view; under reduced
 * motion, or without IntersectionObserver, the finished drawing is there from the start.
 */
export function MoneyFlow() {
  const reduced = useReducedMotion();
  const [ref, seen] = useInView<HTMLElement>();
  const pending = !reduced && !seen;
  const steps = [
    { title: t('mk.flow.hold.title'), body: t('mk.flow.hold.body') },
    { title: t('mk.flow.taken.title'), body: t('mk.flow.taken.body') },
    { title: t('mk.flow.released.title'), body: t('mk.flow.released.body') },
  ];
  return (
    <Section id="flow" title={t('mk.flow.title')} lead={t('mk.flow.lead')}>
      <figure ref={ref} className="gv-flow" data-state={pending ? 'pending' : 'drawn'}>
        <svg
          className="gv-flow__svg"
          viewBox="0 0 640 96"
          role="img"
          aria-label={t('mk.flow.aria')}
          focusable="false"
        >
          <defs>
            <pattern
              id="gv-flow-hatch"
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="2.5" height="8" className="gv-flow__hatch" />
            </pattern>
          </defs>
          <g className="gv-flow__step" style={{ '--gv-i': 0 } as CSSProperties}>
            <rect x="4" y="28" width="176" height="40" className="gv-flow__held" />
          </g>
          <path d="M184 48H228m-8-6 8 6-8 6" pathLength={1} className="gv-flow__arrow" />
          <g className="gv-flow__step" style={{ '--gv-i': 1 } as CSSProperties}>
            <rect x="232" y="28" width="123" height="40" className="gv-flow__solid" />
            <rect x="355" y="28" width="53" height="40" className="gv-flow__hollow" />
          </g>
          <path d="M412 48H456m-8-6 8 6-8 6" pathLength={1} className="gv-flow__arrow" />
          <g className="gv-flow__step" style={{ '--gv-i': 2 } as CSSProperties}>
            <rect x="460" y="28" width="176" height="40" className="gv-flow__hollow" />
          </g>
        </svg>
        <ol className="gv-flow__list">
          {steps.map((s) => (
            <li key={s.title} className="gv-flow__item">
              <h3 className="gv-flow__title">{s.title}</h3>
              <p className="gv-flow__body">{s.body}</p>
            </li>
          ))}
        </ol>
      </figure>
    </Section>
  );
}
