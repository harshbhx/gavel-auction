import data from './generated/repo-data.json';

// Written by scripts/gen-repo-data.mjs from docs/GATES.md and docs/evidence/SIM/SIM-MULTIDAY.md.
export type GateRow = { id: string; title: string; status: string; run: string };
export type SpeechRow = {
  clipSet: string;
  provider: string;
  n: number;
  exact: string;
  wrongAccept: string;
  confirm: string;
  missedBid: string;
};
export type LatencyRow = { call: string; p50: number; p95: number; max: number };
export type SimScenario = { id: string; title: string; checks: string; result: string };

export const repoData = data as {
  gates: GateRow[];
  speech: SpeechRow[];
  latency: LatencyRow[];
  sim: {
    scenarios: SimScenario[];
    s8: {
      lotsSettled: number;
      lotsInReview: number;
      holds: number;
      reauthorizeCalls: number;
      crashesSurvived: number;
      faultsArmed: number;
      fallbackLots: number;
      stormLots: number;
      stormSettled: number;
      heldCents: number;
      capturedCents: number;
      releasedCents: number;
      openCents: number;
      seed: string;
    };
  };
};

export function gateById(id: string): GateRow {
  const g = repoData.gates.find((x) => x.id === id);
  if (!g) throw new Error(`gate ${id} missing from generated data`);
  return g;
}

export function usd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export const gatesPassed = () => repoData.gates.filter((g) => g.status === 'PASS').length;
