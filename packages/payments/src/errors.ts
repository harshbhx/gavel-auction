import type { ErrorKind, Outcome } from './types.js';

export interface PayPalErrorInit {
  kind: ErrorKind;
  status: number;
  /** PayPal error name, or a local name when no response exists. */
  name: string;
  message: string;
  issue?: string;
  debugId?: string;
  outcome: Outcome;
}

export class PayPalError extends Error {
  kind: ErrorKind;
  status: number;
  issue?: string;
  debugId?: string;
  outcome: Outcome;

  constructor(init: PayPalErrorInit) {
    super(init.message);
    this.name = init.name;
    this.kind = init.kind;
    this.status = init.status;
    if (init.issue !== undefined) this.issue = init.issue;
    if (init.debugId !== undefined) this.debugId = init.debugId;
    this.outcome = init.outcome;
  }
}
