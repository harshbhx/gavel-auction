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

/** Copy key for an error result, or null when the generic one applies. */
export function errorKey(code: string | undefined): 'reg.popupBlocked' | 'reg.expired' | null {
  if (code === 'popup_blocked') return 'reg.popupBlocked';
  if (code === 'registration_missing' || code === 'order_mismatch') return 'reg.expired';
  return null;
}

/** Registration step 3: the eight approval states with a recovery action each (R-WEB-045). */
export function Approve({
  state,
  result,
  ceilingCents,
  closed = false,
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
      const key = errorKey(result?.errorCode);
      return (
        <section>
          <p role="alert">{t(key ?? 'generic.error')}</p>
          {key === 'reg.expired' ? (
            <Button onClick={onBackToCeiling}>{t('generic.back')}</Button>
          ) : (
            <Button onClick={onRetry}>{t('generic.retry')}</Button>
          )}
        </section>
      );
    }
  }
}
