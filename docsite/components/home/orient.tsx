import Link from 'next/link';
import { ArrowRight, FlaskConical, Gavel, Scale } from 'lucide-react';
import { Section } from './section';

const steps = [
  {
    n: 1,
    icon: Scale,
    title: 'Read the claim',
    time: '2 min',
    text: 'The two-minute path: five clicks that show what GAVEL claims and what its status is.',
    href: '/docs/judges/two-minute-path',
  },
  {
    n: 2,
    icon: FlaskConical,
    title: 'Check the proof',
    time: '4 min',
    text: 'Six gates, each with its run and its stamp: PASS, PARTIAL or simulated. Four ran on the PayPal sandbox, G3 is a timed probe and G5 is a speech evaluation.',
    href: '/docs/proof',
  },
  {
    n: 3,
    icon: Gavel,
    title: 'Break it on paper',
    time: '5 min',
    text: 'Crash recovery and the tough questions: what happens when the server dies at the hammer.',
    href: '/docs/how-it-works/crash-recovery',
  },
];

/** A three step orientation, set like numbered boxes on a printed form. */
export function Orient() {
  return (
    <Section labelledBy="orient-title" className="border-b-2 border-[var(--hl-fg)]">
      <header className="mb-8 max-w-3xl">
        <p className="hl-eyebrow">Orientation</p>
        <h2 id="orient-title" className="hl-display mt-2 text-4xl md:text-5xl">
          Eleven minutes, three steps.
        </h2>
      </header>
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="hl-card hl-step">
            <Link href={s.href} className="flex h-full flex-col p-5">
              <span className="hl-step__n hl-display" aria-hidden>
                {s.n}
              </span>
              <span className="flex items-center gap-2">
                <s.icon className="size-5 text-fd-primary" aria-hidden />
                <span className="hl-display text-2xl">{s.title}</span>
              </span>
              <span className="hl-eyebrow mt-1">About {s.time}</span>
              <span className="mt-3 flex-1 text-sm text-fd-muted-foreground">{s.text}</span>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-fd-primary">
                Go <ArrowRight className="size-4" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}
