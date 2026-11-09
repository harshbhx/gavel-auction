import { useEffect, useState } from 'react';

/**
 * What the host says about speech. `available`: a live speech provider is set. `off`: the host
 * answered and has none. `unreachable`: no answer, so nothing is known.
 */
export type VoiceCapability = 'checking' | 'available' | 'off' | 'unreachable';

/** Asks the capability probe. Never throws, never sends a credential. */
export async function fetchVoiceCapability(apiBase: string): Promise<VoiceCapability> {
  try {
    const res = await fetch(`${apiBase.replace(/\/+$/, '')}/api/judge/capabilities`);
    if (!res.ok) return 'unreachable';
    const body = (await res.json()) as unknown;
    if (typeof body !== 'object' || body === null) return 'unreachable';
    return (body as { voice?: unknown }).voice === true ? 'available' : 'off';
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
