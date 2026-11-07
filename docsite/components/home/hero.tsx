import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { FillLegend } from '@/components/holdline/legend';
import { HoldResolver } from './hold-resolver';
import { btnPrimary, btnSecondary } from './section';

/**
 * First screen: the thesis in one sentence, who it is for, and the object that proves it.
 * The layout is deliberately lopsided: a wide left column of type and a lot card that
 * overhangs the grid on the right.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="border-b border-[var(--hl-border)] px-4 pt-10 pb-14 md:pt-16 md:pb-20">
      <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-12 lg:gap-6 [&>*]:min-w-0">
        <div className="lg:col-span-7 lg:pt-6">
          <p className="hl-eyebrow">PayPal hackathon 2026 | documentation, sandbox only</p>
          <h1 id="hero-title" className="hl-display mt-5 text-[clamp(3rem,7vw,5.4rem)]">
            The hammer falls.
            <br />
            <span className="text-[var(--hl-signal-ink)]">Only the winner pays.</span>
          </h1>
          <p className="mt-7 max-w-[34rem] font-[family-name:var(--font-newsreader)] text-[1.3rem] leading-snug">
            Every online auction has one ugly moment: the gavel comes down and the winner has gone quiet.
            GAVEL asks for the money first. A bid is a PayPal hold, so when the hammer falls we charge the
            winning price and let everything else go.
          </p>
          <p className="mt-4 max-w-[34rem] text-[0.95rem] text-fd-muted-foreground">
            These pages are the receipts. Each claim points at a file or a run, and what has only been
            tried on a fake or a simulation says so.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/docs/judges" className={btnPrimary}>
              Start with the judge guide <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/docs/proof" className={btnSecondary}>
              See the proof
            </Link>
          </div>
        </div>

        <div className="lg:col-span-5 lg:col-start-8 lg:-mr-6 lg:mt-14">
          <div className="lg:-rotate-[0.6deg]">
            <HoldResolver />
          </div>
          <FillLegend className="mt-4" />
          <p className="mt-3 max-w-sm text-[0.8rem] text-fd-muted-foreground">
            Try it: drag the price, or replay the hammer. Three bidders, one winner; the same rule the
            ledger follows, in whole cents.
          </p>
        </div>
      </div>
    </section>
  );
}
