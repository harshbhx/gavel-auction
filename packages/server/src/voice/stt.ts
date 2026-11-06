import {
  FailoverStt,
  SttConfigError,
  parseTimeline,
  realClock,
  selectProvider,
  ReplayStt,
  type FailoverClock,
  type ReplayScheduler,
  type SelectDeps,
  type SttEnv,
  type SttProvider,
  type Timeline,
} from '@gavel/voice';

/** Variables the speech choice reads. No key is ever required. */
export interface SttChoiceEnv {
  VOICE_STT?: string | undefined;
  GROQ_API_KEY?: string | undefined;
}

export interface SttChoiceDeps {
  /** Recorded events the cached provider plays; defaults to a recording with no speech. */
  timeline?: Timeline;
  scheduler?: ReplayScheduler;
  failoverClock?: FailoverClock;
  fetch?: SelectDeps['fetch'];
  log?: (message: string, fields: Record<string, string>) => void;
}

export interface SttChoice {
  /** Provider family in use: `replay`, `fake`, or the live name when a key is configured. */
  readonly name: string;
  /** A new provider for one audio stream. */
  make(): SttProvider;
}

const realScheduler: ReplayScheduler = {
  setTimeout: (fn, ms) => Number(setTimeout(fn, ms)),
  clearTimeout: (id) => clearTimeout(id),
};

const EMPTY_TIMELINE: Timeline = parseTimeline({ utterances: [] });

/**
 * Choose the speech provider from config (R-VOX-022). With no VOICE_STT the cached provider runs,
 * so nothing needs a key. A live provider is used only when named and its key is present; it runs
 * behind a failover to the cached provider. A named provider whose key is missing is logged and
 * the cached provider is used instead, so a missing key never stops the host.
 */
export function chooseStt(env: SttChoiceEnv, deps: SttChoiceDeps = {}): SttChoice {
  const timeline = deps.timeline ?? EMPTY_TIMELINE;
  const scheduler = deps.scheduler ?? realScheduler;
  const replay = (): SttProvider => new ReplayStt(timeline, scheduler);
  const cached: SttChoice = { name: 'replay', make: replay };
  const raw = env.VOICE_STT?.trim().toLowerCase();
  if (raw === undefined || raw === '' || raw === 'replay') return cached;

  const selectEnv: SttEnv = { VOICE_STT: raw };
  const liveKey = env.GROQ_API_KEY;
  if (liveKey !== undefined) selectEnv.GROQ_API_KEY = liveKey;
  const selectDeps: SelectDeps = {
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.log !== undefined ? { log: (m, f) => deps.log?.(m, f) } : {}),
    warn: () => undefined,
  };
  let first: SttProvider;
  try {
    first = selectProvider(selectEnv, selectDeps);
  } catch (e) {
    if (e instanceof SttConfigError) {
      deps.log?.('stt provider not usable, using cached provider', { reason: e.code });
      return cached;
    }
    throw e;
  }
  if (first.name === 'fake')
    return { name: 'fake', make: () => selectProvider(selectEnv, selectDeps) };
  return {
    name: first.name,
    make: () =>
      new FailoverStt({
        primary: () => selectProvider(selectEnv, selectDeps),
        fallback: replay,
        clock: deps.failoverClock ?? realClock,
      }),
  };
}
