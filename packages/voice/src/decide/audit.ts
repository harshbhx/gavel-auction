import {
  auditRecordSchema,
  toAuditRecord,
  type AuditRecord,
  type ConfirmPrompt,
  type Decision,
} from '../types.js';

/** Keys a persisted audit record may carry (R-VOX-071, T-VOX-103). */
export const AUDIT_KEYS: readonly string[] = [
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

export const EVIDENCE_KEYS: readonly string[] = [
  'segmentId',
  'idempotencyKey',
  'transcript',
  'audioStartMs',
  'audioEndMs',
  'sttProvider',
  'sttConfidence',
  'replay',
  'rules',
  'llm',
  'confidence',
  'reason',
] as const;

/** One audit record per decision, drops included. Throws if the record leaves the allow-list. */
export function buildAudit(decision: Decision): AuditRecord {
  return auditRecordSchema.parse(toAuditRecord(decision));
}

export type AriaLive = 'polite' | 'assertive';

/** Non-audio alternatives for every voice action (R-VOX-072). */
export const ALT_ACTION = {
  caption: 'manual_entry',
  confirm: 'confirm_buttons',
} as const;

export interface CaptionPayload {
  text: string;
  ariaLive: 'polite';
  altActionId: typeof ALT_ACTION.caption;
}

export interface PromptPayload {
  promptId: string;
  text: string;
  ariaLive: 'assertive';
  altActionId: typeof ALT_ACTION.confirm;
}

/** Captions are announced politely and always have a manual entry alternative. */
export function captionPayload(text: string): CaptionPayload {
  return { text, ariaLive: 'polite', altActionId: ALT_ACTION.caption };
}

/** Confirm prompts are announced assertively and always have a button alternative. */
export function promptPayload(prompt: ConfirmPrompt): PromptPayload {
  return {
    promptId: prompt.promptId,
    text: prompt.text,
    ariaLive: 'assertive',
    altActionId: ALT_ACTION.confirm,
  };
}
