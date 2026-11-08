import Link from 'next/link';
import { siteIndex } from '@/lib/site-index';
import { tour } from '@/lib/tour';

// The numbered list on the guided-tour page. Fails the build if a step points at a page that
// does not exist, so the tour cannot rot quietly.
export function TourSteps() {
  const { pages } = siteIndex();
  for (const s of tour) {
    if (!pages.has(s.href)) throw new Error(`Tour step ${s.n} points at ${s.href}, which is not a docs page`);
  }
  return (
    <ol className="hl-tour not-prose">
      {tour.map((s) => (
        <li key={s.n} className="hl-tour__item">
          <span className="hl-tour__num" aria-hidden="true">
            {s.n}
          </span>
          <div>
            <p className="hl-tour__asks">{s.asks}</p>
            <h3 className="hl-tour__title">
              <Link href={s.href}>
                <span className="sr-only">Step {s.n}: </span>
                {s.title}
              </Link>
            </h3>
            <p className="hl-tour__blurb">{s.blurb}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
