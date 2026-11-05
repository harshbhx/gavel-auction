import { FakeStt, VirtualClock } from './fake.js';
import { GroqStt, type FetchLike } from './groq.js';
import type { SttProvider } from './provider.js';

export const STT_NAMES = ['deepgram', 'groq', 'webspeech', 'fake', 'replay'] as const;
export type SttName = (typeof STT_NAMES)[number];

/** Deterministic default order when VOICE_STT is unset (R-VOX-022). */
export const DEFAULT_STT_ORDER: readonly SttName[] = ['deepgram', 'groq'];

/** Server environment subset read here; keys never leave this module and are never logged. */
export interface SttEnv {
  VOICE_STT?: string;
  DEEPGRAM_API_KEY?: string;
  GROQ_API_KEY?: string;
}

export type SttConfigErrorCode =
  | 'unknown_provider'
  | 'missing_key'
  | 'unavailable'
  | 'none_configured';

/** Typed startup error; the message never contains a key. */
export class SttConfigError extends Error {
  readonly code: SttConfigErrorCode;
  constructor(code: SttConfigErrorCode, message: string) {
    super(message);
    this.name = 'SttConfigError';
    this.code = code;
  }
}

export interface SelectDeps {
  /** Builders by provider name; a provider without a builder is unavailable. */
  factories?: Partial<Record<SttName, (env: SttEnv) => SttProvider>>;
  fetch?: FetchLike;
  /** Called once per selectProvider call with the chosen name. */
  log?: (message: string, fields: { provider: SttName }) => void;
}

function keyFor(name: SttName, env: SttEnv): string | undefined {
  const v = name === 'deepgram' ? env.DEEPGRAM_API_KEY : name === 'groq' ? env.GROQ_API_KEY : 'n/a';
  return v === undefined || v === '' ? undefined : v;
}

function build(name: SttName, env: SttEnv, deps: SelectDeps): SttProvider | null {
  const custom = deps.factories?.[name];
  if (custom) return custom(env);
  if (name === 'groq') {
    const apiKey = env.GROQ_API_KEY;
    const f = deps.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!apiKey || !f) return null;
    return new GroqStt({ apiKey, fetch: f });
  }
  if (name === 'fake') return new FakeStt({ clock: new VirtualClock() });
  return null;
}

/** Pick the STT provider from config, log the choice once and return it. */
export function selectProvider(env: SttEnv, deps: SelectDeps = {}): SttProvider {
  const raw = env.VOICE_STT?.trim().toLowerCase();
  let chosen: SttProvider | null = null;
  let chosenName: SttName | null = null;

  if (raw === undefined || raw === '') {
    for (const name of DEFAULT_STT_ORDER) {
      if (!keyFor(name, env)) continue;
      const p = build(name, env, deps);
      if (p) {
        chosen = p;
        chosenName = name;
        break;
      }
    }
    if (!chosen) {
      throw new SttConfigError(
        'none_configured',
        `no STT provider is configured; set a key for one of: ${DEFAULT_STT_ORDER.join(', ')}`,
      );
    }
  } else {
    const name = STT_NAMES.find((n) => n === raw);
    if (!name) {
      throw new SttConfigError(
        'unknown_provider',
        `VOICE_STT must be one of: ${STT_NAMES.join(', ')}`,
      );
    }
    if (!keyFor(name, env)) {
      throw new SttConfigError(
        'missing_key',
        `VOICE_STT=${name} needs its API key in the environment`,
      );
    }
    chosen = build(name, env, deps);
    chosenName = name;
    if (!chosen) {
      throw new SttConfigError(
        'unavailable',
        `STT provider ${name} is not available in this build`,
      );
    }
  }

  if (!chosen || !chosenName) {
    throw new SttConfigError('none_configured', 'no STT provider could be built');
  }
  deps.log?.('stt provider selected', { provider: chosenName });
  return chosen;
}
