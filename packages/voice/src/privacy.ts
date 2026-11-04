export const PRIVACY_NOTICE =
  'Audio is sent to a speech service to read bids. Do not speak personal data.';

export const PERSISTED_VOICE_KEYS: readonly string[] = [
  'transcript',
  'parseResult',
  'confidence',
  'timestampMs',
  'provider',
  'decision',
  'confirmOutcome',
] as const;

export type CaptureState =
  | 'idle'
  | 'requesting'
  | 'denied'
  | 'no_device'
  | 'unsupported'
  | 'insecure_context'
  | 'running'
  | 'muted'
  | 'degraded'
  | 'error';

export function micInUse(state: CaptureState): boolean {
  return state === 'running' || state === 'muted';
}
