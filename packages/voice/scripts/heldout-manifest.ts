/**
 * Expands the 40 held-out utterances into the clip manifest of the G5 held-out noisy set (issue 2192,
 * docs/evidence/G5/HELDOUT-NOISY-PREREG.md). Pure and deterministic: the committed
 * fixtures/audio-heldout/manifest.json must equal the output (test/eval/heldout-manifest.test.ts).
 */

export const HELDOUT_SNRS_DB = [20, 10, 5] as const;
export type HeldoutNoise = 'room' | 'babble';

export interface HeldoutUtterance {
  id: string;
  text: string;
  category: string;
  /** eSpeak NG voice name, passed to espeak-ng -v. */
  voice: string;
  speakerBidderId: string | null;
  context: Record<string, unknown>;
  expected: Record<string, unknown>;
  acceptableConfirm: unknown[];
}

export interface HeldoutClip extends HeldoutUtterance {
  /** The utterance this clip was rendered from. */
  utterance: string;
  /** Per-SNR category, so the report breaks results down by SNR. */
  category: string;
  noise: HeldoutNoise;
  snrDb: number;
  seed: number;
}

/** Even utterance numbers get room noise, odd ones babble: 20 of each at every SNR. */
export function noiseOf(utteranceNumber: number): HeldoutNoise {
  return utteranceNumber % 2 === 0 ? 'room' : 'babble';
}

export function expandHeldout(utterances: readonly HeldoutUtterance[]): HeldoutClip[] {
  const out: HeldoutClip[] = [];
  utterances.forEach((u, i) => {
    HELDOUT_SNRS_DB.forEach((snrDb, j) => {
      const noise = noiseOf(i + 1);
      out.push({
        ...u,
        id: `${u.id}-s${snrDb}-${noise}`,
        utterance: u.id,
        category: `snr${snrDb}`,
        noise,
        snrDb,
        seed: 6000 + i * HELDOUT_SNRS_DB.length + j,
      });
    });
  });
  return out;
}
