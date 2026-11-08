import Link from 'next/link';
import {
  ArrowRight,
  BookOpenCheck,
  FlaskConical,
  Hammer,
  Map,
  Scale,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { Hero } from '@/components/home/hero';
import { HoldBeam } from '@/components/home/hold-beam';
import { Section, SectionHeading, btnPrimary, btnSecondary } from '@/components/home/section';
import CountUp from '@/components/home/reactbits/CountUp';
import { Orient } from '@/components/home/orient';
import { Reveal } from '@/components/home/reveal';
import { GatesTable } from '@/components/holdline/data-tables';
import { Chip } from '@/components/holdline/chip';
import { SagaDiagram } from '@/components/diagrams/saga';
import { MoneyFlowDiagram } from '@/components/diagrams/money-flow';
import { VoiceDiagram } from '@/components/diagrams/voice';
import { TimelineDiagram } from '@/components/diagrams/timeline';
import { CrashDiagram } from '@/components/diagrams/crash';
import { gatesPassed, repoData } from '@/lib/repo-data';

const paths = [
  {
    href: '/docs/judges',
    icon: Scale,
    title: 'For judges',
    text: 'Start here if you score GAVEL without running it: two paths, a rubric map and honest answers.',
  },
  {
    href: '/docs/start',
    icon: BookOpenCheck,
    title: 'Start here',
    text: 'The judge path: what to open first, what is real, what is simulated, and the concepts in one page.',
  },
  {
    href: '/docs/how-it-works',
    icon: Hammer,
    title: 'How it works',
    text: 'Money flow, the settlement saga, crash recovery, the voice confirm gate, engine and ledger.',
  },
  {
    href: '/docs/proof',
    icon: FlaskConical,
    title: 'Proof',
    text: 'Gates G0 to G5 with the real numbers, the simulated 30 days, latency and accessibility.',
  },
  {
    href: '/docs/safety',
    icon: ShieldCheck,
    title: 'Safety',
    text: 'Sandbox-only rules, the security review checklist (all open), webhooks, backups.',
  },
  {
    href: '/docs/run',
    icon: Terminal,
    title: 'Run it yourself',
    text: 'Local run on the fake PayPal, the real sandbox, staging deploy, re-running a gate.',
  },
  {
    href: '/docs/roadmap',
    icon: Map,
    title: 'Roadmap and limits',
    text: 'The honest list of what is not done, and what the next days of the G3 probe decide.',
  },
];

const faq = [
  {
    q: 'Does any real money move?',
    a: 'No. GAVEL talks to the PayPal sandbox only, and production mode refuses the fake PayPal. The whole site carries the sandbox notice on every page.',
  },
  {
    q: 'What does a hold actually do?',
    a: 'A bidder approves a PayPal authorization for their ceiling. It is a promise, not a charge. At the hammer the saga captures the winning price only; the rest of the money is released.',
  },
  {
    q: 'What if the server crashes during settlement?',
    a: 'The saga journals its intent before each PayPal call and, on restart, reads the truth at PayPal first. That recovery is verified with injected crashes against the fake PayPal; no real server kill has run on a hosted host.',
  },
  {
    q: 'Does voice bidding work?',
    a: 'It exists, but the speech accuracy gate (G5) is only PARTIAL: wrong accepts are 0.000 on 24 synthetic, noise-free clips after fixes chosen on those same clips, and there is no real-room test. Spoken bids always wait for a confirmation. No live speech run is recorded.',
  },
  {
    q: 'Is there a hosted demo?',
    a: 'Yes, in sandbox mode: the web app is at gavel-web.creharsh.workers.dev and the API at gavel-auction-aufz.onrender.com. Storage is temporary until a disk is added, and nobody has walked the whole flow on it yet. The demo guide lists what is verified.',
  },
];

export default function HomePage() {
  const s8 = repoData.sim.s8;
  const stats: Array<{ value: number; suffix?: string; of?: string; label: string; chip: React.ReactNode }> = [
    {
      value: gatesPassed(),
      of: ' of 6',
      label: 'PayPal sandbox gates passed: G0, G1, G2, G4. G3 is in progress, G5 is partial (synthetic audio only).',
      chip: <Chip kind="solid">Sandbox, PASS</Chip>,
    },
    {
      value: s8.lotsSettled,
      of: ` of ${s8.lotsSettled + s8.lotsInReview}`,
      label: 'simulated lots settled in the 30 day run, none in review.',
      chip: <Chip kind="hatched">Simulated</Chip>,
    },
    {
      value: s8.crashesSurvived,
      label: 'simulated process crashes survived, with no double capture.',
      chip: <Chip kind="hatched">Simulated</Chip>,
    },
    {
      value: s8.holds,
      label: 'simulated holds, every one captured or released, none left open.',
      chip: <Chip kind="hatched">Simulated</Chip>,
    },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-x-clip">
      <Hero />

      <Orient />

      <Section labelledBy="stats-title" className="border-b border-[var(--hl-hairline)]">
        <SectionHeading id="stats-title" eyebrow="Status, stated plainly" title="What we can prove, and how.">
          Numbers come from the committed gate record and the simulation output, read at build time.
        </SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Reveal key={s.label} className="h-full">
              <div className="hl-card flex h-full flex-col p-5">
                <div>{s.chip}</div>
                <p className="hl-display mt-4 text-6xl">
                  <CountUp to={s.value} duration={1.6} />
                  {s.of && <span className="text-3xl text-fd-muted-foreground">{s.of}</span>}
                </p>
                <p className="mt-3 text-sm text-fd-muted-foreground">{s.label}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section labelledBy="paths-title">
        <SectionHeading id="paths-title" eyebrow="Pick a path" title="Judge path first, then the rest.">
          The pages are short: one screen of prose, one diagram, and a list of the files that hold the
          claim.
        </SectionHeading>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {paths.map((p, i) => (
            <Reveal key={p.href} delay={i * 0.05} className={i === 0 ? "h-full md:col-span-2 lg:col-span-3" : "h-full"}>
              <div className={i === 0 ? "hl-card hl-card--feature h-full" : "hl-card h-full"}>
                <Link href={p.href} className="flex h-full flex-col p-6 focus-visible:outline-2">
                  <p.icon className="size-6 text-fd-primary" aria-hidden />
                  <h3 className="hl-display mt-4 text-2xl">{p.title}</h3>
                  <p className="mt-2 flex-1 text-sm text-fd-muted-foreground">{p.text}</p>
                  <span className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-fd-primary">
                    Open <ArrowRight className="size-4" aria-hidden />
                  </span>
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section id="how" labelledBy="how-title" className="border-y border-[var(--hl-hairline)] bg-fd-card/40">
        <SectionHeading id="how-title" eyebrow="The idea" title="Commit before the first bid.">
          Online auctions break at the hammer: the winner may never pay. GAVEL moves the money question to
          the start. The bidder&apos;s ceiling is held by PayPal, and only the winning price is ever charged.
        </SectionHeading>
        <HoldBeam />
      </Section>

      <Section id="diagrams" labelledBy="diagrams-title">
        <SectionHeading id="diagrams-title" eyebrow="Five diagrams" title="The mechanism, drawn from the code.">
          Each figure uses the product&apos;s own language: hatched means held, solid means charged, hollow
          means released. State and event names are the ones in the source, and each figure says what it
          was verified against.
        </SectionHeading>
        <h3 className="hl-display mt-2 text-3xl">1. Where the money is</h3>
        <MoneyFlowDiagram />
        <h3 className="hl-display mt-10 text-3xl">2. The settlement saga</h3>
        <SagaDiagram />
        <h3 className="hl-display mt-10 text-3xl">3. Crash recovery</h3>
        <CrashDiagram />
        <h3 className="hl-display mt-10 text-3xl">4. Voice, and the confirm gate</h3>
        <VoiceDiagram />
        <h3 className="hl-display mt-10 text-3xl">5. Thirty simulated days</h3>
        <TimelineDiagram />
      </Section>

      <Section id="gates" labelledBy="gates-title" className="border-t border-[var(--hl-hairline)] bg-fd-card/40">
        <SectionHeading id="gates-title" eyebrow="Proof" title="Six gates against the real sandbox.">
          Source of truth: <code>docs/GATES.md</code>. A gate closes only with a recorded result.
        </SectionHeading>
        <GatesTable />
        <p className="text-sm text-fd-muted-foreground">
          Behaviour that no passed gate covers is established only against the project&apos;s own fake PayPal.{' '}
          <Link href="/docs/proof/gates" className="font-bold text-fd-primary underline underline-offset-4">
            Read each gate
          </Link>
          .
        </p>
      </Section>

      <Section id="faq" labelledBy="faq-title" className="border-t border-[var(--hl-hairline)]">
        <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions, answered straight." />
        <div className="max-w-3xl divide-y divide-[var(--hl-hairline)] border-y border-[var(--hl-hairline)]">
          {faq.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="cursor-pointer text-lg font-bold">{f.q}</summary>
              <p className="mt-2 text-fd-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section labelledBy="cta-title" className="border-t border-[var(--hl-hairline)]">
        <div className="border-[1.5px] border-[var(--hl-border)] bg-fd-card p-8 md:p-12">
          <h2 id="cta-title" className="hl-display text-4xl md:text-5xl">
            Read it the way a judge would.
          </h2>
          <p className="mt-3 max-w-xl text-fd-muted-foreground">
            Five minutes: the judge path, the proof page, then the crash recovery page.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/docs/start" className={btnPrimary}>
              Start here <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/docs/how-it-works/crash-recovery" className={btnSecondary}>
              Crash recovery
            </Link>
          </div>
        </div>
      </Section>
    </div>
  );
}
