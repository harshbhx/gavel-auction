import type { PolicyConfig } from './policy.js';

/**
 * Default AUTO and CONFIRM thresholds (R-VOX-063). A confidence at or above `auto` with no hard
 * flag may be accepted, from `confirm` up to `auto` forces a prompt, below `confirm` is dropped.
 * Calibration rationale is recorded under G5 in docs/GATES.md.
 */
export const defaultConfig: Readonly<PolicyConfig> = Object.freeze({ auto: 0.85, confirm: 0.5 });
