// Payment approval port (SPEC-web 5.3). The UI talks only to this seam; PayPal specifics live in adapters.

export type ApprovalState =
  | 'idle'
  | 'preparing'
  | 'awaiting_buyer'
  | 'confirming'
  | 'held'
  | 'cancelled'
  | 'declined'
  | 'error';

export interface ApprovalRequest {
  roomId: string;
  bidderId: string;
  ceilingCents: number;
  clientRegistrationId: string;
  /** Set when PayPal already approved this order and only the hold step failed: retry just that step. */
  approvedOrderId?: string;
  /** The hold that order belongs to; the approve route is addressed by it. */
  approvedHoldId?: string;
  /** Called once the server issued the order, so a reload can find it again. */
  onOrder?: (order: { orderId: string; holdId: string }) => void;
}

export interface ApprovalResult {
  state: ApprovalState;
  holdIdSuffix?: string;
  /** The amount the server confirmed it holds; show this, not what the buyer typed. */
  ceilingCents?: number;
  errorCode?: string;
  correlationId?: string;
  /** The order issued for this attempt; kept so a retry or the return route reuses it. */
  orderId?: string;
  /** The hold issued for this attempt; kept with the order so a retry or the return route reuses it. */
  holdId?: string;
}

export interface PaymentApprovalPort {
  /** Runs one approval attempt. Calls `on` for every state after `idle`, then resolves with the final result. */
  start(req: ApprovalRequest, on: (s: ApprovalState) => void): Promise<ApprovalResult>;
  /** Abandons the attempt while the buyer is in the approval window. */
  cancel(): void;
}

/** States after which an attempt is over. */
export const TERMINAL_STATES: readonly ApprovalState[] = ['held', 'cancelled', 'declined', 'error'];

export function isTerminal(s: ApprovalState): boolean {
  return TERMINAL_STATES.includes(s);
}
