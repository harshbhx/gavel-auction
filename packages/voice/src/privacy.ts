export const PRIVACY_NOTICE =
  'Audio is sent to a speech service to read bids. Do not speak personal data.';

/** Top-level keys of a persisted audit record; must equal the keys of `auditRecordSchema`. */
export const PERSISTED_VOICE_KEYS: readonly string[] = [
  'decision',
  'outcome',
  'transcript',
  'bidderId',
  'amountCents',
  'confidence',
  'confirmed',
  'reason',
  'evidence',
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
