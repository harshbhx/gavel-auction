'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

// A reading route for someone who has to score GAVEL. Progress is kept in this browser only
// (localStorage, never sent anywhere) and the page works the same without it.
const steps = [
  { href: '/docs/judges/two-minute-path', title: 'Two-minute path', time: '2 min', what: 'Five clicks that show the claim and the status.' },
  { href: '/docs/judges/rubric-map', title: 'Rubric map', time: '4 min', what: 'Each criterion pointed at pages and files.' },
  { href: '/docs/judges/real-vs-simulated', title: 'Real, simulated, recorded', time: '3 min', what: 'The label sheet: what you are looking at.' },
  { href: '/docs/judges/ten-minute-path', title: 'Ten-minute path', time: '10 min', what: 'Evidence files, the ledger check, the fake demo.' },
  { href: '/docs/judges/tough-questions', title: 'Tough questions', time: '5 min', what: 'Honest answers about voice, G3 and the fake PayPal.' },
] as const;

const KEY = 'gavel-judge-progress';

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function JudgeProgress() {
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => setDone(load()), []);
  const toggle = (href: string) => {
    const next = done.includes(href) ? done.filter((h) => h !== href) : [...done, href];
    setDone(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode: the ticks last for this visit only */
    }
  };
  const n = steps.filter((s) => done.includes(s.href)).length;
  return (
    <section aria-label="Your reading route" className="hl-noprint not-prose my-8 border-[1.5px] border-[var(--hl-border)] bg-[var(--hl-panel)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hl-hairline)] px-4 py-3">
        <p className="hl-eyebrow">A reading route, about 24 minutes in all</p>
        <p className="font-mono text-xs font-bold tabular-nums" aria-live="polite">
          {n} of {steps.length} read
        </p>
      </div>
      <div
        className="h-2 border-b border-[var(--hl-hairline)]"
        role="progressbar"
        aria-label="Pages read"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={n}
      >
        <div className="h-full bg-[var(--hl-go)] transition-[width] duration-300" style={{ width: `${(n / steps.length) * 100}%` }} />
      </div>
      <ol className="divide-y divide-[var(--hl-hairline)]">
        {steps.map((s, i) => {
          const on = done.includes(s.href);
          return (
            <li key={s.href} className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={`Mark ${s.title} as read`}
                onClick={() => toggle(s.href)}
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-[2px] border-[1.5px] border-[var(--hl-border)]',
                  on ? 'bg-[var(--hl-go)] text-[var(--hl-bg)]' : 'bg-transparent',
                )}
              >
                {on && <Check className="size-4" aria-hidden />}
              </button>
              <span className="hl-display w-6 text-2xl text-[var(--hl-signal-ink)]">{i + 1}</span>
              <Link href={s.href} className="min-w-0 flex-1 no-underline hover:underline">
                <span className="block font-bold">{s.title}</span>
                <span className="block text-sm text-fd-muted-foreground">{s.what}</span>
              </Link>
              <span className="shrink-0 font-mono text-xs text-fd-muted-foreground">{s.time}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// The five Stage Two criteria as a printed score sheet: what to open, what state the evidence is
// in, and a box row to tick by hand. It claims nothing about the score.
const criteria = [
  {
    n: 1,
    name: 'Technological implementation',
    open: [
      ['Gates G0 to G5', '/docs/proof/gates'],
      ['Settlement saga', '/docs/how-it-works/settlement-saga'],
      ['Webhooks', '/docs/safety/webhooks'],
    ],
    state: 'G0, G1, G2, G4 PASS on the sandbox. Whole-auction settlement is fake-PayPal only.',
    chip: 'pass',
  },
  {
    n: 2,
    name: 'Design',
    open: [
      ['Accessibility', '/docs/proof/accessibility'],
      ['Demo screens', '/docs/start/demo'],
      ['Concepts', '/docs/start/concepts'],
    ],
    state: 'Automated checks only; the screen-reader pass is not done. The hosted app is not yet walked end to end.',
    chip: 'open',
  },
  {
    n: 3,
    name: 'Potential impact',
    open: [
      ['Start here', '/docs/start'],
      ['Roadmap and limits', '/docs/roadmap/limits'],
    ],
    state: 'An argument, not a measurement: no non-payment rate is quoted.',
    chip: 'open',
  },
  {
    n: 4,
    name: 'Innovation and idea',
    open: [
      ['Money flow', '/docs/how-it-works/money-flow'],
      ['Engine and ledger', '/docs/how-it-works/engine-and-ledger'],
      ['Crash recovery', '/docs/how-it-works/crash-recovery'],
    ],
    state: 'Covered by tests and the fake PayPal; remainder release is inferred, not observed.',
    chip: 'sim',
  },
  {
    n: 5,
    name: 'Presentation',
    open: [
      ['Demo script', '/docs/judges/demo-script'],
      ['Label sheet', '/docs/judges/real-vs-simulated'],
      ['Evidence index', '/docs/judges/evidence-index'],
    ],
    state: 'Script written; the video is an open item in docs/SUBMISSION.md.',
    chip: 'open',
  },
] as const;

const chipText = { pass: 'Sandbox PASS', open: 'Open items', sim: 'Fake or simulated' } as const;
const chipCls = { pass: 'hl-solid-chip', open: 'hl-hatch-chip', sim: 'hl-hollow-chip' } as const;

export function Scorecard() {
  return (
    <section aria-label="Score sheet" className="hl-scorecard not-prose my-8 border-[1.5px] border-[var(--hl-fg)] bg-[var(--hl-panel)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-[3px] border-double border-[var(--hl-fg)] px-4 py-3">
        <p className="hl-display text-2xl">Stage Two score sheet</p>
        <p className="font-mono text-[0.7rem] uppercase tracking-wide text-fd-muted-foreground">
          Five criteria, 1 to 5 each. This sheet scores nothing; it points.
        </p>
      </div>
      <ol>
        {criteria.map((c) => (
          <li key={c.n} className="grid gap-x-6 gap-y-2 border-b border-[var(--hl-hairline)] px-4 py-4 last:border-b-0 md:grid-cols-[3rem_1fr_13rem]">
            <span className="hl-display text-5xl leading-none text-[var(--hl-signal-ink)]">{c.n}</span>
            <div>
              <p className="text-lg font-bold">{c.name}</p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {c.open.map(([t, h]) => (
                  <li key={h}>
                    <Link href={h} className="underline decoration-[var(--hl-signal-ink)] underline-offset-4">
                      {t}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex flex-wrap items-start gap-2 text-sm text-fd-muted-foreground">
                <span className={cn('shrink-0 rounded-[2px] px-1.5 py-px font-mono text-[0.65rem] font-bold uppercase', chipCls[c.chip])}>
                  {chipText[c.chip]}
                </span>
                <span className="min-w-0 flex-1">{c.state}</span>
              </p>
            </div>
            <div aria-hidden className="flex items-end gap-2 md:justify-end">
              {[1, 2, 3, 4, 5].map((v) => (
                <span key={v} className="grid size-8 place-items-center border-[1.5px] border-[var(--hl-border)] font-mono text-xs text-fd-muted-foreground">
                  {v}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <p className="hl-noprint border-t border-[var(--hl-hairline)] px-4 py-2 font-mono text-[0.68rem] text-fd-muted-foreground">
        Print this page to take the sheet with you.
      </p>
    </section>
  );
}
