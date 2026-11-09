import { isHoldErrorCode } from '../copy/errors';
import type { ApprovalRequest, ApprovalResult, ApprovalState, PaymentApprovalPort } from './port';

export interface SimAdapterDeps {
  apiBase: string;
  /** Session bearer token of the joined bidder. */
  token: string;
}

/**
 * The demo way to hold funds in a judge room: no PayPal window and no login. The server writes a
 * simulated hold for the offered ceiling (POST /api/judge/rooms/:id/sim-hold) and puts the bidder
 * in the room. Same port as the PayPal adapter, so the register and approve pages do not change.
 */
export class SimApprovalAdapter implements PaymentApprovalPort {
  private readonly deps: SimAdapterDeps;

  constructor(deps: SimAdapterDeps) {
    this.deps = deps;
  }

  cancel(): void {
    // Nothing to abandon: the call is one request.
  }

  async start(req: ApprovalRequest, on: (s: ApprovalState) => void): Promise<ApprovalResult> {
    const correlationId = `sim-${req.clientRegistrationId.slice(0, 8)}`;
    const finish = (state: ApprovalState, extra: Partial<ApprovalResult> = {}): ApprovalResult => {
      on(state);
      return { state, correlationId, ...extra };
    };
    on('preparing');
    try {
      const res = await fetch(
        `${this.deps.apiBase}/api/judge/rooms/${encodeURIComponent(req.roomId)}/sim-hold`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.deps.token}`,
          },
          body: JSON.stringify({
            ceilingCents: req.ceilingCents,
            name: req.name === undefined || req.name === '' ? 'Guest' : req.name,
          }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: unknown } | null;
        const code = err?.error;
        return finish('error', {
          errorCode: isHoldErrorCode(code) ? code : res.status === 404 ? 'demo_off' : 'hold_failed',
        });
      }
      const body = (await res.json()) as { holdId?: unknown; ceilingCents?: unknown };
      if (typeof body.holdId !== 'string') return finish('error', { errorCode: 'hold_failed' });
      return finish('held', {
        holdIdSuffix: body.holdId.slice(-6),
        holdId: body.holdId,
        ...(typeof body.ceilingCents === 'number' ? { ceilingCents: body.ceilingCents } : {}),
      });
    } catch {
      return finish('error', { errorCode: 'hold_failed' });
    }
  }
}
