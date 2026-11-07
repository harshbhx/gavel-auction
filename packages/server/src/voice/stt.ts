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
  type WsFactory,
} from '@gavel/voice';
import { platformSocketFactory } from './deepgram-socket';

/** Variables the speech choice reads. No key is ever required. */
export interface SttChoiceEnv {
  VOICE_STT?: string | undefined;
  GROQ_API_KEY?: string | undefined;
  DEEPGRAM_API_KEY?: string | undefined;
}

export interface SttChoiceDeps {
  /** Recorded events the cached provider plays; defaults to a recording with no speech. */
  timeline?: Timeline;
  scheduler?: ReplayScheduler;
  failoverClock?: FailoverClock;
  fetch?: SelectDeps['fetch'];
  /** Provider builders for tests; a name present here replaces the real client. */
  factories?: SelectDeps['factories'];
  /** WebSocket transport for Deepgram; defaults to the runtime's own. */
  socket?: WsFactory;
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
 * behind a failover chain that ends at the cached provider. With VOICE_STT=deepgram and a Groq key
 * the chain is Deepgram, then Groq, then cached (R-VOX-019 applied twice), and Deepgram is tried
 * again after the circuit window. A named provider whose key is missing is logged and the next
 * one with a key is used (Groq for a missing Deepgram key), else the cached provider, so a
 * missing key never stops the host.
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
  const { DEEPGRAM_API_KEY } = env;
  if (DEEPGRAM_API_KEY !== undefined) Object.assign(selectEnv, { DEEPGRAM_API_KEY });
  const socket = deps.socket ?? platformSocketFactory();
  const selectDeps: SelectDeps = {
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.factories !== undefined ? { factories: deps.factories } : {}),
    ...(socket !== undefined ? { socket } : {}),
    ...(deps.log !== undefined ? { log: (m, f) => deps.log?.(m, f) } : {}),
    warn: () => undefined,
  };
  const hasGroq = liveKey !== undefined && liveKey !== '';
  const clock = deps.failoverClock ?? realClock;
  // With no recorded timeline the cached provider is mute; never swap a live one for it.
  const replayTranscribes = deps.timeline !== undefined;
  const pick = (name: 'deepgram' | 'groq'): SttProvider =>
    selectProvider({ ...selectEnv, VOICE_STT: name }, selectDeps);
  const groqThenCached = (): SttProvider =>
    new FailoverStt({
      primary: () => pick('groq'),
      fallback: replay,
      fallbackTranscribes: replayTranscribes,
      clock,
    });

  let first: SttProvider;
  try {
    first = selectProvider(selectEnv, selectDeps);
  } catch (e) {
    if (e instanceof SttConfigError) {
      if (raw === 'deepgram' && hasGroq) {
        deps.log?.('deepgram not usable, using groq', { reason: e.code });
        return { name: 'groq', make: groqThenCached };
      }
      deps.log?.('stt provider not usable, using cached provider', { reason: e.code });
      return cached;
    }
    throw e;
  }
  if (first.name === 'fake')
    return { name: 'fake', make: () => selectProvider(selectEnv, selectDeps) };
  if (raw === 'deepgram' && hasGroq) {
    return {
      name: first.name,
      make: () =>
        new FailoverStt({
          primary: () => pick('deepgram'),
          fallback: groqThenCached,
          // Groq transcribes live, so a silent or late Deepgram can always be swapped out.
          fallbackTranscribes: true,
          clock,
        }),
    };
  }
  return {
    name: first.name,
    make: () =>
      new FailoverStt({
        primary: () => selectProvider(selectEnv, selectDeps),
        fallback: replay,
        fallbackTranscribes: replayTranscribes,
        clock,
      }),
  };
}
