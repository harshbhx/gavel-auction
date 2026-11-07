import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import BlurText from './reactbits/BlurText';
import ShinyText from './reactbits/ShinyText';
import { BorderBeam } from './magicui/border-beam';
import { FillLegend } from '@/components/holdline/legend';
import { btnPrimary, btnSecondary } from './section';

/** A specimen of the thesis: three holds, one winning price, in the three fills. */
function Specimen() {
  const bar = 'h-7 rounded-[2px]';
  return (
    <div className="relative overflow-hidden border-[1.5px] border-[var(--hl-border)] bg-fd-card p-5">
      <BorderBeam size={220} duration={9} colorFrom="var(--hl-signal)" colorTo="var(--hl-go)" />
      <p className="hl-eyebrow">Example: three holds, one winning price of $350</p>
      <div className="mt-5 space-y-4" role="img" aria-label="Bidder A holds 500 dollars, of which 350 is charged and 150 released. Bidder B holds 300 dollars, released. Bidder C holds 200 dollars, released.">
        <div>
          <div className="mb-1 flex justify-between font-mono text-xs">
            <span>A  hold $500</span>
            <span className="font-bold text-[var(--hl-go)]">charged $350</span>
          </div>
          <div className="flex">
            <div className={`${bar} hl-solid-chip`} style={{ width: '70%' }} />
            <div className={`${bar} hl-hollow-chip`} style={{ width: '30%' }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between font-mono text-xs">
            <span>B  hold $300</span>
            <span className="text-fd-muted-foreground">released</span>
          </div>
          <div className={`${bar} hl-hollow-chip`} style={{ width: '60%' }} />
        </div>
        <div>
          <div className="mb-1 flex justify-between font-mono text-xs">
            <span>C  hold $200</span>
            <span className="text-fd-muted-foreground">released</span>
          </div>
          <div className={`${bar} hl-hollow-chip`} style={{ width: '40%' }} />
        </div>
        <div>
          <div className="mb-1 font-mono text-xs text-fd-muted-foreground">Before the hammer, every hold looks like this:</div>
          <div className={`${bar} hl-hatch-chip`} style={{ width: '100%' }} />
        </div>
      </div>
      <FillLegend className="mt-5" />
    </div>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="hl-grid-bg border-b border-[var(--hl-hairline)] px-4 py-14 md:py-24">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.15fr_1fr] [&>*]:min-w-0">
        <div>
          <p className="hl-eyebrow flex items-center gap-2">
            <ShieldCheck className="size-4 text-fd-primary" aria-hidden />
            <ShinyText speed={4}>PayPal sandbox hackathon project, documentation</ShinyText>
          </p>
          <h1 id="hero-title" className="hl-display mt-4 text-5xl sm:text-6xl md:text-7xl">
            <BlurText as="span" text="Every bid is a PayPal hold." delay={90} animateBy="words" />
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-fd-muted-foreground">
            Only the winning price is captured. Every other hold is voided and released. A journaled
            settlement saga and a hash-chained audit trail keep the result checkable, and these docs say
            exactly which parts have been proven on the PayPal sandbox and which have not.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/docs/start" className={btnPrimary}>
              Start here: the judge path <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/docs/proof" className={btnSecondary}>
              See the proof
            </Link>
          </div>
        </div>
        <Specimen />
      </div>
    </section>
  );
}
