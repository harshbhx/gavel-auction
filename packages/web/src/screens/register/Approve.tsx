import { useEffect, useState } from 'react';

import { en, type CopyKey } from '../../copy/en';
import { holdErrorCopyTable, isHoldErrorCode } from '../../copy/errors';
import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Banner } from '../../design/primitives/Banner';
import { Button } from '../../design/primitives/Button';
import type { ApprovalResult, ApprovalState } from '../../payments/port';
import { formatUsdCompact } from '../../util/money';

export const SUFFIX_LENGTH = 6;

export interface ApproveProps {
  state: ApprovalState;
  result: ApprovalResult | null;
  /** The ceiling the buyer chose; shown when the server did not echo one. */
  ceilingCents: number;
  /** Registration is closed (room already bidding and late entry is off). */
  closed?: boolean;
  /** The paddle the server assigned to this bidder, once the roster shows it. */
  paddle?: number;
  /** Watch-only link target, offered when registration is closed. */
  watchHref?: string;
  /** Back to the ceiling step with the choice kept. */
  onBackToCeiling: () => void;
  onRetry: () => void;
  onContinue: () => void;
}

/** Last six characters of a hold id. */
export function holdSuffix(id: string): string {
  return id.slice(-SUFFIX_LENGTH);
}

/** What the buyer can do next after an error. */
export type ErrorAction = 'retry' | 'back' | 'continue' | 'wait';

export interface ErrorView {
  key: CopyKey;
  action: ErrorAction;
}

/** How long Try again stays off after the payments side said it is unavailable. */
export const UNAVAILABLE_RETRY_MS = 5000;

/** Copy and recovery for an error result: every payments code has its own text and next step. */
export function errorView(code: string | undefined): ErrorView {
  if (code === 'popup_blocked' || code === 'popup_failed') {
    return { key: 'reg.popupBlocked', action: 'retry' };
  }
  if (code === 'registration_missing' || code === 'order_mismatch') {
    return { key: 'reg.expired', action: 'back' };
  }
  if (code !== undefined && isHoldErrorCode(code)) {
    const key = holdErrorCopyTable[code];
    switch (code) {
      case 'hold_exists':
        return { key, action: 'continue' };
      case 'order_not_approved':
        return { key, action: 'retry' };
      case 'paypal_unavailable':
      case 'kill_switch_engaged':
        return { key, action: 'wait' };
      case 'ceiling_out_of_range':
      case 'order_not_found':
      case 'payments_not_sandbox':
        return { key, action: 'back' };
    }
  }
  return { key: 'generic.error', action: 'retry' };
}

/** Try again that stays off for a short while, so a closed service is not hammered. */
function DelayedRetry({ onRetry }: { onRetry: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), UNAVAILABLE_RETRY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Button disabled={!ready} onClick={onRetry}>
      {t('generic.retry')}
    </Button>
  );
}

/** Registration step 3: the eight approval states with a recovery action each (R-WEB-045). */
export function Approve({
  state,
  result,
  ceilingCents,
  closed = false,
  paddle,
  watchHref = '/',
  onBackToCeiling,
  onRetry,
  onContinue,
}: ApproveProps) {
  if (closed) {
    return (
      <section>
        <Banner tone="info" icon={<Icon name="lock" />}>
          {t('reg.closed')}
        </Banner>
        <a href={watchHref}>{t('reg.watch')}</a>
      </section>
    );
  }

  switch (state) {
    case 'idle':
      return null;
    case 'preparing':
    case 'confirming':
      return <p role="status">{t('reg.confirming')}</p>;
    case 'awaiting_buyer':
      return <p role="status">{t('reg.awaiting')}</p>;
    case 'held': {
      const amount = result?.ceilingCents ?? ceilingCents;
      const full = result?.holdId;
      const suffix = result?.holdIdSuffix ?? (full === undefined ? '' : holdSuffix(full));
      return (
        <section data-testid="held-card">
          <p>
            <Icon name="check" />
            <strong>{t('reg.held', { amount: formatUsdCompact(amount) })}</strong>
          </p>
          <p>{t('reg.heldRef', { suffix })}</p>
          {paddle !== undefined && <p>{t('reg.yourPaddle', { n: paddle })}</p>}
          {full !== undefined && (
            <details>
              <summary>{t('generic.details')}</summary>
              <code>{full}</code>
            </details>
          )}
          <Button size="bid" onClick={onContinue}>
            {t('reg.continue')}
          </Button>
        </section>
      );
    }
    case 'cancelled':
      return (
        <section>
          <p role="status">{t('reg.cancelled')}</p>
          <Button onClick={onBackToCeiling}>{t('generic.back')}</Button>
        </section>
      );
    case 'declined':
      return (
        <section>
          <p role="alert">{t('reg.declined')}</p>
          <Button onClick={onBackToCeiling}>{t('generic.back')}</Button>
        </section>
      );
    case 'error': {
      const view = errorView(result?.errorCode);
      return (
        <section>
          <p role="alert">{en[view.key]}</p>
          {view.action === 'retry' && <Button onClick={onRetry}>{t('generic.retry')}</Button>}
          {view.action === 'wait' && <DelayedRetry onRetry={onRetry} />}
          {view.action === 'continue' && (
            <>
              <Button size="bid" onClick={onContinue}>
                {t('reg.continue')}
              </Button>
              <Button variant="outline" onClick={onBackToCeiling}>
                {t('reg.startAgain')}
              </Button>
            </>
          )}
          {view.action === 'back' && (
            <Button onClick={onBackToCeiling}>
              {t(view.key === 'err.pay.orderNotFound' ? 'reg.startAgain' : 'generic.back')}
            </Button>
          )}
        </section>
      );
    }
  }
}
