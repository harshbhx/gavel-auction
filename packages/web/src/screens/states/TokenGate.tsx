import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../../copy/t';
import { TokenHelp } from '../hub/TokenHelp';
import '../flows.css';

export type GateRole = 'auctioneer' | 'reviewer' | 'screen';

/** Shape check only. The server decides whether a token is valid (R-WEB-031). */
export function looksLikeToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9._~+/=-]{8,}$/.test(token);
}

export interface TokenGateProps {
  readonly role: GateRole;
  /** The stored token for this room, or null when none. */
  readonly token: string | null | undefined;
  /** Where a new link can be requested. */
  readonly launcherHref?: string;
  /** The room the link named, so the help can point back to its hub. */
  readonly roomId?: string | undefined;
  readonly children: ReactNode;
}

/** Refuses to render the console or audit view without a token that looks valid. */
export function TokenGate({
  role,
  token,
  launcherHref = '/demo',
  roomId,
  children,
}: TokenGateProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const allowed = looksLikeToken(token);
  useEffect(() => {
    if (!allowed) heading.current?.focus();
  }, [allowed]);
  if (allowed) return <>{children}</>;
  return (
    <main className="gv-flow" data-route="token-gate" data-role={role}>
      <p className="ui-kicker">{t('app.name')}</p>
      <h1 ref={heading} tabIndex={-1}>
        {t('err.tokenMissing')}
      </h1>
      <TokenHelp roomId={roomId} />
      <a className="gv-flow__action" href={launcherHref}>
        {t('err.newLink')}
      </a>
    </main>
  );
}

export default TokenGate;
