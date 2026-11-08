import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { StatusPill } from '../../ui';
import { formatCountdown } from '../../util/time';
import { ROOM_MINUTES, type HubKeys } from './hubKeys';
import { ScreenPreview } from './ScreenPreview';
import '../flows.css';
import './hub.css';

const QrCode = lazy(() => import('../join/QrCode'));

export interface JudgeHubProps {
  readonly roomId: string;
  readonly keys: HubKeys;
  /** Server base for the public room summary and bidder invites; none means no network. */
  readonly apiBase?: string | undefined;
  /** Site origin the links are built on. */
  readonly origin: string;
  readonly now?: () => number;
  readonly writeClipboard?: (text: string) => Promise<void>;
}

interface Invite {
  /** Absolute register link; its fragment holds the single-use invite. */
  readonly link: string;
}

type InviteState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly invite: Invite };

interface Summary {
  readonly title: string | null;
  readonly code: string | null;
}

async function mintInvite(
  apiBase: string,
  roomId: string,
  token: string,
  origin: string,
): Promise<Invite | null> {
  try {
    const res = await fetch(`${apiBase}/api/auctions/${encodeURIComponent(roomId)}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{"count":1}',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { invites?: ReadonlyArray<{ link?: unknown }> };
    const link = body.invites?.[0]?.link;
    if (typeof link !== 'string') return null;
    const at = link.indexOf('#');
    if (at < 0) return null;
    return {
      link: `${origin}/r/${encodeURIComponent(roomId)}/register${link.slice(at)}`,
    };
  } catch {
    return null;
  }
}

async function fetchSummary(apiBase: string, roomId: string): Promise<Summary | null> {
  try {
    const res = await fetch(`${apiBase}/api/auctions/${encodeURIComponent(roomId)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { joinCode?: unknown; title?: unknown };
    return {
      code: typeof body.joinCode === 'string' && body.joinCode !== '' ? body.joinCode : null,
      title: typeof body.title === 'string' && body.title !== '' ? body.title : null,
    };
  } catch {
    return null;
  }
}

/** Flap board join code: one dark tile per character, like the price board. */
function Flaps({ code }: { code: string | null }) {
  if (code === null) return <p className="gv-hub__pending">{t('hub.codePending')}</p>;
  return (
    <p className="gv-hub__flaps" aria-label={`${t('hub.codeLabel')} ${code.split('').join(' ')}`}>
      {code.split('').map((ch, i) => (
        <span key={`${ch}${i}`} className="gv-hub__flap" aria-hidden="true">
          {ch}
        </span>
      ))}
    </p>
  );
}

/** A console or bidder shortcut: short title, one line, the actions. */
function Shortcut({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  const id = `gv-hub-step-${n}`;
  return (
    <section className="gv-hub__card" aria-labelledby={id} data-step={n}>
      <h2 id={id}>{title}</h2>
      <p className="gv-hub__hint">{hint}</p>
      <div className="gv-hub__body">{children}</div>
    </section>
  );
}

/** The judge's one page after a room is made: screen, code and QR, console and bidder. */
export function JudgeHub({
  roomId,
  keys,
  apiBase,
  origin,
  now = Date.now,
  writeClipboard = (text) => navigator.clipboard.writeText(text),
}: JudgeHubProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [summary, setSummary] = useState<Summary>({ title: null, code: keys.code });
  const code = summary.code;
  const [invite, setInvite] = useState<InviteState>({ kind: 'idle' });
  const [copied, setCopied] = useState<string | null>(null);
  const [tick, setTick] = useState(() => now());
  const asked = useRef(false);
  const newTab = ` (${t('hub.opensNewTab')})`;
  const base = `${origin}/r/${encodeURIComponent(roomId)}`;
  const screenLink = keys.screen === null ? null : `${base}/screen#token=${keys.screen}`;
  const consoleLink = keys.auctioneer === null ? null : `${base}/console#token=${keys.auctioneer}`;
  // Only the read-only reviewer token opens the audit link here; the console token is not shown.
  const auditLink =
    keys.reviewer === undefined || keys.reviewer === null
      ? null
      : `${base}/audit#token=${keys.reviewer}`;
  const joinQuery = code === null ? '' : `?c=${encodeURIComponent(code)}`;
  const joinLink = `${origin}/join/${encodeURIComponent(roomId)}${joinQuery}`;

  useEffect(() => {
    document.title = t('hub.title');
    heading.current?.focus();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick(now()), 1_000);
    return () => clearInterval(id);
  }, [now]);

  useEffect(() => {
    if (apiBase === undefined) return undefined;
    let live = true;
    fetchSummary(apiBase, roomId).then((got) => {
      if (live && got !== null)
        setSummary((prev) => ({ title: got.title, code: got.code ?? prev.code }));
    });
    return () => {
      live = false;
    };
  }, [apiBase, roomId]);

  const auctioneer = keys.auctioneer;
  const makeInvite = useCallback((): void => {
    if (apiBase === undefined || auctioneer === null) return;
    setInvite({ kind: 'busy' });
    mintInvite(apiBase, roomId, auctioneer, origin).then((got) =>
      setInvite(got === null ? { kind: 'failed' } : { kind: 'ready', invite: got }),
    );
  }, [apiBase, auctioneer, roomId, origin]);

  // The first invite is made on arrival, so the QR is ready for a phone straight away.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    makeInvite();
  }, [makeInvite]);

  const copy = (key: string, text: string): void => {
    writeClipboard(text).then(
      () => setCopied(key),
      () => setCopied(null),
    );
  };

  const bidderLink = invite.kind === 'ready' ? invite.invite.link : null;
  // The QR is the join link with the room code: it works for every phone, not just the first one.
  const qrTarget = joinLink;
  const leftMs = keys.expiresAt === null ? null : keys.expiresAt - tick;

  const shareText = [
    t('hub.shareHeader'),
    code === null ? '' : `${t('hub.codeLabel')}: ${code}`,
    screenLink === null ? '' : `${t('hub.step1')}: ${screenLink}`,
    consoleLink === null ? '' : `${t('hub.step3')}: ${consoleLink}`,
    `${t('hub.joinLinkLabel')}: ${joinLink}`,
    t('hub.expiresAt', { minutes: ROOM_MINUTES }),
  ]
    .filter((line) => line !== '')
    .join('\n');

  return (
    <main className="gv-hub" data-route="hub">
      <header className="gv-hub__head">
        <div className="gv-hub__titles">
          <p className="ui-kicker">{`${t('app.name')} / ${t('hub.kicker')}`}</p>
          <h1 ref={heading} tabIndex={-1}>
            {t('hub.title')}
          </h1>
          <p className="gv-hub__lead">{t('hub.lead')}</p>
        </div>
        <p className="gv-hub__status">
          {leftMs === null ? (
            <StatusPill tone="live">{t('hub.expiresAt', { minutes: ROOM_MINUTES })}</StatusPill>
          ) : leftMs > 0 ? (
            <StatusPill tone="live">
              {t('hub.closesIn', { time: formatCountdown(leftMs) })}
            </StatusPill>
          ) : (
            <StatusPill tone="out">{t('hub.expired')}</StatusPill>
          )}
        </p>
      </header>

      <div className="gv-hub__grid">
        <section className="gv-hub__screen" aria-labelledby="gv-hub-step-1" data-step={1}>
          <h2 id="gv-hub-step-1">{t('hub.step1')}</h2>
          <ScreenPreview
            roomId={roomId}
            token={keys.screen}
            apiBase={apiBase}
            lotTitle={summary.title ?? t('screen.untitled')}
            code={code}
            joinUrl={joinLink}
          />
          <div className="gv-hub__row">
            {screenLink === null ? (
              <p className="gv-hub__missing">{t('hub.noToken')}</p>
            ) : (
              <>
                <a className="gv-flow__action" href={screenLink} target="_blank" rel="noopener">
                  {t('hub.step1Open')}
                  <span className="gv-visually-hidden">{newTab}</span>
                </a>
                <Button variant="outline" onClick={() => copy('screen', screenLink)}>
                  {copied === 'screen' ? t('generic.copied') : t('generic.copy')}
                </Button>
              </>
            )}
          </div>
          <aside className="gv-hub__test" aria-labelledby="gv-hub-test">
            <h3 id="gv-hub-test">{t('hub.testTitle')}</h3>
            <ol>
              <li>{t('hub.test1')}</li>
              <li>{t('hub.test2')}</li>
              <li>{t('hub.test3')}</li>
              <li>{t('hub.test4')}</li>
              <li>{t('hub.test5')}</li>
            </ol>
          </aside>
        </section>

        <section className="gv-hub__ticket" aria-labelledby="gv-hub-step-2" data-step={2}>
          <div className="gv-hub__stub">
            <p className="ui-kicker">{t('hub.ticketAdmit')}</p>
            <h2 id="gv-hub-step-2">{t('hub.ticket')}</h2>
            <p className="gv-hub__kicker-code">{t('hub.codeLabel')}</p>
            <Flaps code={code} />
          </div>
          <div className="gv-hub__perf" aria-hidden="true" />
          <div className="gv-hub__main">
            <div className="gv-hub__qr" role="group" aria-label={t('hub.qrLabel')}>
              <Suspense fallback={null}>
                <QrCode url={qrTarget} size={196} />
              </Suspense>
            </div>
            <p className="gv-hub__scan">{t('hub.scanToBid')}</p>
            <div className="gv-hub__row gv-hub__row--center">
              {code !== null && (
                <Button variant="outline" onClick={() => copy('code', code)}>
                  {copied === 'code' ? t('generic.copied') : t('hub.copyCode')}
                </Button>
              )}
              <Button
                variant="outline"
                disabled={code === null}
                onClick={() => copy('invite', joinLink)}
              >
                {copied === 'invite' ? t('generic.copied') : t('hub.copyInvite')}
              </Button>
            </div>
            <p className="gv-hub__joinlink" data-testid="hub-join-link">
              <span className="gv-hub__joinlabel">{t('hub.joinLinkLabel')}</span> {joinLink}
            </p>
          </div>
        </section>

        <div className="gv-hub__side">
          <Shortcut n={3} title={t('hub.step3')} hint={t('hub.step3Hint')}>
            {consoleLink === null ? (
              <p className="gv-hub__missing">{t('hub.noToken')}</p>
            ) : (
              <>
                <a className="gv-flow__action" href={consoleLink} target="_blank" rel="noopener">
                  {t('hub.step3Open')}
                  <span className="gv-visually-hidden">{newTab}</span>
                </a>
                <Button variant="outline" onClick={() => copy('console', consoleLink)}>
                  {copied === 'console' ? t('generic.copied') : t('generic.copy')}
                </Button>
              </>
            )}
          </Shortcut>

          <Shortcut n={4} title={t('hub.step4')} hint={t('hub.step4Hint')}>
            <a
              className="gv-flow__action"
              href={joinLink}
              target="_blank"
              rel="noopener"
              data-testid="hub-join-open"
            >
              {t('hub.joinHere')}
              <span className="gv-visually-hidden">{newTab}</span>
            </a>
            {keys.auctioneer === null ? (
              <p className="gv-hub__note">{t('hub.watcherNote')}</p>
            ) : (
              <>
                {bidderLink !== null ? (
                  <a className="gv-flow__action" href={bidderLink} target="_blank" rel="noopener">
                    {t('hub.step4Open')}
                    <span className="gv-visually-hidden">{newTab}</span>
                  </a>
                ) : invite.kind === 'failed' ? (
                  <p className="gv-hub__missing" role="alert">
                    {t('hub.inviteFailed')}
                  </p>
                ) : (
                  <p className="gv-hub__pending" role="status">
                    {t('hub.inviteBusy')}
                  </p>
                )}
                <Button variant="outline" disabled={invite.kind === 'busy'} onClick={makeInvite}>
                  {t('hub.newInvite')}
                </Button>
              </>
            )}
          </Shortcut>

          <div className="gv-hub__more">
            <Button onClick={() => copy('all', shareText)}>
              {copied === 'all' ? t('hub.shareCopied') : t('hub.shareAll')}
            </Button>
            {auditLink !== null && (
              <a
                className="gv-flow__action gv-flow__action--plain"
                href={auditLink}
                target="_blank"
                rel="noopener"
                data-testid="hub-audit-link"
              >
                {t('hub.auditLink')}
                <span className="gv-visually-hidden">{newTab}</span>
              </a>
            )}
            <a className="gv-flow__action gv-flow__action--plain" href="/verify">
              {t('hub.verifyLink')}
            </a>
            <a className="gv-flow__action gv-flow__action--plain" href="/demo">
              {t('hub.newDemo')}
            </a>
            <p className="gv-hub__note">{t('hub.expiresAt', { minutes: ROOM_MINUTES })}</p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default JudgeHub;
