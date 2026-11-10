import { useEffect, useState } from 'react';

/**
 * What the host says about speech. `available`: a live speech provider is set. `replay`: no live
 * provider, but the host plays a recorded demo run. `off`: the host answered and has neither.
 * `unreachable`: no answer, so nothing is known.
 */
export type VoiceCapability = 'checking' | 'available' | 'replay' | 'off' | 'unreachable';

/** Asks the capability probe. Never throws, never sends a credential. */
export async function fetchVoiceCapability(apiBase: string): Promise<VoiceCapability> {
  try {
    const res = await fetch(`${apiBase.replace(/\/+$/, '')}/api/judge/capabilities`);
    if (!res.ok) return 'unreachable';
    const body = (await res.json()) as unknown;
    if (typeof body !== 'object' || body === null) return 'unreachable';
    const found = body as { voice?: unknown; voiceReplay?: unknown };
    if (found.voice === true) return 'available';
    return found.voiceReplay === true ? 'replay' : 'off';
  } catch {
    return 'unreachable';
  }
}

/** Reads the capability once per host while `enabled`. */
export function useVoiceCapability(apiBase: string, enabled: boolean): VoiceCapability {
  const [found, setFound] = useState<{ base: string; value: VoiceCapability } | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    void fetchVoiceCapability(apiBase).then((value) => {
      if (live) setFound({ base: apiBase, value });
    });
    return () => {
      live = false;
    };
  }, [apiBase, enabled]);
  return found !== null && found.base === apiBase ? found.value : 'checking';
}
