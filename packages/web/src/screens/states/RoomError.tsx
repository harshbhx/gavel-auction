import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Banner } from '../../design/primitives/Banner';
import { Button } from '../../design/primitives/Button';
import { TERMINAL_ERRORS, WAIT_ERRORS } from '../../net/connection';

export interface RoomErrorProps {
  /** The latest error frame the server sent, or null. */
  error: { code: string; message: string; retryAfterMs: number | null } | null;
  /** Where a bidder joins again after the token was refused. */
  rejoinHref: string;
  /** Opens the connection again, offered for a refusal that only needs a wait. */
  onRetry: () => void;
}

/** True when the refusal ended this session, so the stored token is dead. */
export function isTerminalError(code: string): boolean {
  return TERMINAL_ERRORS.includes(code);
}

/** True when the refusal stopped the connection (a dead token, or a wait the bidder must end). */
export function isHaltingError(code: string): boolean {
  return TERMINAL_ERRORS.includes(code) || WAIT_ERRORS.includes(code);
}

function messageFor(error: NonNullable<RoomErrorProps['error']>): string {
  if (isTerminalError(error.code)) return t('err.tokenMissing');
  if (error.code === 'room_full' || error.code === 'auction_full' || error.code === 'room_cap') {
    return t('err.room.full');
  }
  if (error.code === 'rate_limited') {
    return error.retryAfterMs === null
      ? t('err.room.rateLimitedSoon')
      : t('err.room.rateLimited', { seconds: Math.max(1, Math.ceil(error.retryAfterMs / 1000)) });
  }
  return t('generic.error');
}

/** Shows the server's refusal on a live route, with the way forward for that refusal. */
export function RoomError({ error, rejoinHref, onRetry }: RoomErrorProps) {
  if (error === null) return null;
  const terminal = isTerminalError(error.code);
  const waiting = !terminal && isHaltingError(error.code);
  return (
    <div role="alert" data-testid="room-error">
      <Banner tone="danger" icon={<Icon name="warning" />}>
        {messageFor(error)}
      </Banner>
      {terminal && <a href={rejoinHref}>{t('err.rejoin')}</a>}
      {waiting && <Button onClick={onRetry}>{t('generic.retry')}</Button>}
    </div>
  );
}
