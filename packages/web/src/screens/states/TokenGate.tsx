import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../../copy/t';

export type GateRole = 'auctioneer' | 'reviewer';

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
  readonly children: ReactNode;
}

/** Refuses to render the console or audit view without a token that looks valid. */
export function TokenGate({ role, token, launcherHref = '/demo', children }: TokenGateProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const allowed = looksLikeToken(token);
  useEffect(() => {
    if (!allowed) heading.current?.focus();
  }, [allowed]);
  if (allowed) return <>{children}</>;
  return (
    <main data-route="token-gate" data-role={role}>
      <h1 ref={heading} tabIndex={-1}>
        {t('err.tokenMissing')}
      </h1>
      <a href={launcherHref}>{t('err.newLink')}</a>
    </main>
  );
}

export default TokenGate;
