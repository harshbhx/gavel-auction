import { t } from '../../copy/t';
import { Section } from './LandingSections';
import './landing-story.css';

/** The product in three beats, right under the hero: hold, hammer, receipt. */
export function StorySection() {
  const beats = [
    { n: 1, title: t('mk.story.s1.title'), body: t('mk.story.s1.body') },
    { n: 2, title: t('mk.story.s2.title'), body: t('mk.story.s2.body') },
    { n: 3, title: t('mk.story.s3.title'), body: t('mk.story.s3.body') },
  ];
  return (
    <Section id="story" title={t('mk.story.title')} lead={t('mk.story.lead')}>
      <ol className="gv-story">
        {beats.map((b) => (
          <li key={b.n} className="gv-story__beat gv-reveal" data-beat={b.n}>
            <span className="gv-story__num" aria-hidden="true">
              {b.n}
            </span>
            <h3 className="gv-story__title">{b.title}</h3>
            <p className="gv-story__body">{b.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

interface Shot {
  id: 'console' | 'screen' | 'bidder' | 'receipt';
  src: string;
  width: number;
  height: number;
  cap: string;
  alt: string;
}

/**
 * Real screenshots of the app, taken by the screen tour on the test stage (a simulated room with
 * sample amounts) and stored as small WebP files. The section says so in its note.
 */
export function ShotsSection() {
  const shots: Shot[] = [
    {
      id: 'console',
      src: '/landing/console.webp',
      width: 1000,
      height: 694,
      cap: t('mk.shots.console.cap'),
      alt: t('mk.shots.console.alt'),
    },
    {
      id: 'screen',
      src: '/landing/screen.webp',
      width: 1000,
      height: 677,
      cap: t('mk.shots.screen.cap'),
      alt: t('mk.shots.screen.alt'),
    },
    {
      id: 'bidder',
      src: '/landing/bidder.webp',
      width: 480,
      height: 794,
      cap: t('mk.shots.bidder.cap'),
      alt: t('mk.shots.bidder.alt'),
    },
    {
      id: 'receipt',
      src: '/landing/receipt.webp',
      width: 480,
      height: 960,
      cap: t('mk.shots.receipt.cap'),
      alt: t('mk.shots.receipt.alt'),
    },
  ];
  return (
    <Section id="screens" title={t('mk.shots.title')} lead={t('mk.shots.lead')}>
      <div className="gv-shots">
        {shots.map((s) => (
          <figure key={s.id} className={`gv-shot gv-shot--${s.id} gv-reveal`}>
            <img
              className="gv-shot__img"
              src={s.src}
              width={s.width}
              height={s.height}
              alt={s.alt}
              loading="lazy"
              decoding="async"
            />
            <figcaption className="gv-shot__cap">{s.cap}</figcaption>
          </figure>
        ))}
      </div>
      <p className="gv-trust__note">{t('mk.shots.note')}</p>
    </Section>
  );
}
