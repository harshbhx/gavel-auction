'use client';

import { useRef } from 'react';
import { Gavel, Landmark, Users } from 'lucide-react';
import { AnimatedBeam } from './magicui/animated-beam';

function Node({ refEl, icon, label, sub }: { refEl: React.RefObject<HTMLDivElement | null>; icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="z-10 flex flex-col items-center gap-2 text-center">
      <div
        ref={refEl}
        className="grid size-16 place-items-center rounded-[2px] border-[1.5px] border-[var(--hl-border)] bg-fd-card"
      >
        {icon}
      </div>
      <p className="font-mono text-xs font-bold uppercase">{label}</p>
      <p className="max-w-[9rem] text-xs text-fd-muted-foreground">{sub}</p>
    </div>
  );
}

/** Bidder, GAVEL, PayPal: a beam shows the hold moving to PayPal (a decorative figure). */
export function HoldBeam() {
  const container = useRef<HTMLDivElement>(null);
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const c = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={container}
      className="relative mx-auto flex w-full max-w-3xl items-start justify-between border border-[var(--hl-hairline)] bg-fd-card px-6 py-8"
    >
      <Node refEl={a} icon={<Users className="size-7" aria-hidden />} label="Bidder" sub="approves a ceiling" />
      <Node refEl={b} icon={<Gavel className="size-7" aria-hidden />} label="GAVEL" sub="bids, ledger, saga" />
      <Node refEl={c} icon={<Landmark className="size-7" aria-hidden />} label="PayPal sandbox" sub="holds the money" />
      <AnimatedBeam containerRef={container} fromRef={a} toRef={b} curvature={-30} gradientStartColor="#FFB224" gradientStopColor="#62E39A" pathColor="var(--hl-border)" pathOpacity={0.5} />
      <AnimatedBeam containerRef={container} fromRef={b} toRef={c} curvature={-30} delay={1.2} gradientStartColor="#FFB224" gradientStopColor="#62E39A" pathColor="var(--hl-border)" pathOpacity={0.5} />
    </div>
  );
}
