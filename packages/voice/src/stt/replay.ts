import { z } from 'zod';
import { EventChannel, type SttEvent, type SttProvider } from './provider.js';

const word = z
  .object({
    word: z.string(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const sttEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('interim'), text: z.string(), startMs: z.number().min(0) }).strict(),
  z
    .object({
      type: z.literal('final'),
      text: z.string(),
      words: z.array(word),
      startMs: z.number().min(0),
      endMs: z.number().min(0),
      confidence: z.number().min(0).max(1),
      speechFinal: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('utterance_end'), atMs: z.number().min(0) }).strict(),
  z
    .object({
      type: z.literal('error'),
      code: z.enum(['timeout', 'closed', 'auth', 'rate_limited', 'bad_audio', 'unknown']),
      retryable: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('state'),
      state: z.enum(['connecting', 'open', 'reconnecting', 'closed']),
    })
    .strict(),
]);

export const expectedOutcomeSchema = z
  .object({
    kind: z.enum(['accept', 'confirm', 'drop']),
    bidderId: z.string().nullable(),
    amountCents: z.number().int().min(0).nullable(),
  })
  .strict();
export type ExpectedOutcome = z.infer<typeof expectedOutcomeSchema>;

export const timelineSchema = z
  .object({
    utterances: z.array(
      z
        .object({
          startMs: z.number().int().min(0),
          endMs: z.number().int().min(0),
          expected: expectedOutcomeSchema,
          /** Cached mode: recorded events with offsets from the start of the timeline. */
          events: z.array(
            z.object({ atMs: z.number().int().min(0), event: sttEventSchema }).strict(),
          ),
        })
        .strict()
        .refine((u) => u.endMs >= u.startMs, { message: 'endMs before startMs' }),
    ),
  })
  .strict()
  .refine(
    (t) =>
      t.utterances.every((u, i) => {
        const prev = t.utterances[i - 1];
        return prev === undefined || u.startMs >= prev.startMs;
      }),
    { message: 'utterances must be ordered by startMs' },
  );
export type Timeline = z.infer<typeof timelineSchema>;

/** Throws a ZodError when the timeline is malformed (R-VOX-083). */
export function parseTimeline(input: unknown): Timeline {
  return timelineSchema.parse(input);
}

/** Scheduler the replay runs on; a virtual clock in tests, real timers in the browser. */
export interface ReplayScheduler {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/**
 * Cached STT mode (R-VOX-082): emits recorded events at recorded offsets and ends by itself
 * with a closed state, so no keys or network are needed. Audio written to it is ignored.
 */
export class ReplayStt implements SttProvider {
  readonly name = 'replay' as const;
  private readonly channel = new EventChannel<SttEvent>();
  private timerIds: number[] = [];
  private open = false;
  private ended = false;

  constructor(
    private readonly timeline: Timeline,
    private readonly scheduler: ReplayScheduler,
  ) {}

  start(): Promise<void> {
    if (this.open || this.ended) return Promise.resolve();
    this.open = true;
    this.channel.push({ type: 'state', state: 'connecting' });
    this.channel.push({ type: 'state', state: 'open' });
    let last = 0;
    for (const u of this.timeline.utterances) {
      for (const e of u.events) {
        last = Math.max(last, e.atMs);
        this.timerIds.push(this.scheduler.setTimeout(() => this.emit(e.event), e.atMs));
      }
    }
    this.timerIds.push(this.scheduler.setTimeout(() => this.finish(), last + 1));
    return Promise.resolve();
  }

  write(): void {
    // Recorded events drive the run; live audio is not used.
  }

  events(): AsyncIterable<SttEvent> {
    return this.channel.iterable();
  }

  stop(): Promise<void> {
    this.finish();
    return Promise.resolve();
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.open = false;
    for (const id of this.timerIds) this.scheduler.clearTimeout(id);
    this.timerIds = [];
    this.channel.push({ type: 'state', state: 'closed' });
    this.channel.close();
  }

  private emit(event: SttEvent): void {
    if (this.open) this.channel.push(event);
  }
}
