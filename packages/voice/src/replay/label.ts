import type { Decision, PipelineEvent, VoiceEvidence } from '../types.js';

/** Shown whenever audio comes from a recording (R-VOX-084). */
export const REPLAY_LABEL = 'Recorded audio replay';

export type ReplayEvent = PipelineEvent & { replay: true };

export interface ReplayStatusPayload {
  replay: true;
  label: typeof REPLAY_LABEL;
}

export function replayEvidence(evidence: VoiceEvidence): VoiceEvidence {
  return { ...evidence, replay: true };
}

export function replayDecision(decision: Decision): Decision {
  return { ...decision, evidence: replayEvidence(decision.evidence) };
}

/** Tags any pipeline event produced during replay; decisions also get replay=true evidence. */
export function tagReplay(event: PipelineEvent): ReplayEvent {
  if (event.type === 'decision') {
    return { ...event, decision: replayDecision(event.decision), replay: true };
  }
  return { ...event, replay: true };
}

/** UI payload that tells recorded and live paths apart. */
export function replayStatusPayload(): ReplayStatusPayload {
  return { replay: true, label: REPLAY_LABEL };
}
