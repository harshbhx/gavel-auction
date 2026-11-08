import Link from 'next/link';
import { tour, tourStepOf } from '@/lib/tour';

// Shown on the ten tour pages: a progress strip above the title and Previous / Next under the body.
// The strip is a plain list of links, so it works without script and reads as "step 3 of 10".
export function TourBar({ url }: { url: string }) {
  const step = tourStepOf(url);
  if (!step) return null;
  return (
    <nav aria-label="Guided tour" className="hl-tourbar not-prose mb-4">
      <p className="hl-tourbar__label">
        <Link href="/docs/start/guided-tour">Guided tour</Link>
        <span aria-hidden="true"> / </span>
        <span>
          Step {step.n} of {tour.length}: {step.title}
        </span>
      </p>
      <ol className="hl-tourbar__dots">
        {tour.map((s) => (
          <li key={s.n}>
            <Link
              href={s.href}
              aria-label={`Step ${s.n}: ${s.title}`}
              aria-current={s.n === step.n ? 'step' : undefined}
              data-done={s.n < step.n || undefined}
              data-here={s.n === step.n || undefined}
            />
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function TourPager({ url }: { url: string }) {
  const step = tourStepOf(url);
  if (!step) return null;
  const prev = tour[step.n - 2];
  const next = tour[step.n];
  return (
    <nav aria-label="Guided tour: previous and next" className="hl-pager not-prose mt-10">
      <p className="hl-eyebrow mb-2">
        Guided tour, step {step.n} of {tour.length}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {prev ? (
          <Link href={prev.href} rel="prev" className="hl-pager__link">
            <span className="hl-pager__dir">Previous: step {prev.n}</span>
            <span className="hl-pager__title">{prev.title}</span>
          </Link>
        ) : (
          <Link href="/docs/start/guided-tour" className="hl-pager__link">
            <span className="hl-pager__dir">Back to</span>
            <span className="hl-pager__title">The guided tour</span>
          </Link>
        )}
        {next ? (
          <Link href={next.href} rel="next" className="hl-pager__link hl-pager__link--next">
            <span className="hl-pager__dir">Next: step {next.n}</span>
            <span className="hl-pager__title">{next.title}</span>
          </Link>
        ) : (
          <Link href="/docs/reference/glossary" className="hl-pager__link hl-pager__link--next">
            <span className="hl-pager__dir">End of the tour</span>
            <span className="hl-pager__title">Glossary</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
