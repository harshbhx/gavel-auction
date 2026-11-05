import { answerConfirm, type AnsweredBy } from '../decide/answer.js';
import type { BidContext, Decision } from '../types.js';

/**
 * One-action reject of an open confirm prompt (R-VOX-092). Nothing is placed: the result is a
 * drop that keeps the original evidence and reason, so the audit record reads rejected.
 * Returns null when the decision is not a confirm.
 */
export function rejectPrompt(decision: Decision, ctx: BidContext, by: AnsweredBy): Decision | null {
  if (decision.kind !== 'confirm') return null;
  const outcome = answerConfirm({ prompt: decision.prompt, ctx, optionId: null, by });
  if (outcome.kind !== 'rejected') return null;
  return { kind: 'drop', reason: decision.evidence.reason, evidence: decision.evidence };
}
