import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { StatusPill } from '../../ui';
import { ROOM_MINUTES, type HubKeys } from './hubKeys';
import '../flows.css';
import './hub.css';

const QrCode = lazy(() => import('../join/QrCode'));

/** The QR renderer reaches version 14 at level M; longer links fall back to the short join link. */
const QR_MAX_BYTES = 320;

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

async function fetchCode(apiBase: string, roomId: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase}/api/auctions/${encodeURIComponent(roomId)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { joinCode?: unknown };
    return typeof body.joinCode === 'string' && body.joinCode !== '' ? body.joinCode : null;
  } catch {
    return null;
  }
}

function minutesLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

/** One labelled step: a number, a heading, a hint and the actions. */
function Step({
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
      <span className="gv-hub__num" aria-hidden="true">
        {n}
      </span>
      <h2 id={id}>{title}</h2>
      <p className="gv-hub__hint">{hint}</p>
      <div className="gv-hub__body">{children}</div>
    </section>
  );
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
  const [code, setCode] = useState<string | null>(keys.code);
  const [invite, setInvite] = useState<InviteState>({ kind: 'idle' });
  const [copied, setCopied] = useState<string | null>(null);
  const [tick, setTick] = useState(() => now());
  const asked = useRef(false);
  const newTab = ` (${t('hub.opensNewTab')})`;
  const base = `${origin}/r/${encodeURIComponent(roomId)}`;
  const screenLink = keys.screen === null ? null : `${base}/screen#token=${keys.screen}`;
  const consoleLink = keys.auctioneer === null ? null : `${base}/console#token=${keys.auctioneer}`;
  const joinQuery = code === null ? '' : `?c=${encodeURIComponent(code)}`;
  const joinLink = `${origin}/join/${encodeURIComponent(roomId)}${joinQuery}`;

  useEffect(() => {
    document.title = t('hub.title');
    heading.current?.focus();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick(now()), 15_000);
    return () => clearInterval(id);
  }, [now]);

  useEffect(() => {
    if (code !== null || apiBase === undefined) return undefined;
    let live = true;
    fetchCode(apiBase, roomId).then((got) => {
      if (live && got !== null) setCode(got);
    });
    return () => {
      live = false;
    };
  }, [apiBase, roomId, code]);

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
  const qrTarget =
    bidderLink !== null && new TextEncoder().encode(bidderLink).length <= QR_MAX_BYTES
      ? bidderLink
      : joinLink;
  const left = keys.expiresAt === null ? null : minutesLeft(keys.expiresAt, tick);

  const shareText = [
    t('hub.shareHeader'),
    code === null ? '' : `${t('hub.codeLabel')}: ${code}`,
    screenLink === null ? '' : `${t('hub.step1')}: ${screenLink}`,
    consoleLink === null ? '' : `${t('hub.step3')}: ${consoleLink}`,
    bidderLink === null ? `${t('hub.step4')}: ${joinLink}` : `${t('hub.step4')}: ${bidderLink}`,
    t('hub.expiresAt', { minutes: ROOM_MINUTES }),
  ]
    .filter((line) => line !== '')
    .join('\n');

  return (
    <main className="gv-hub" data-route="hub">
      <header className="gv-hub__head">
        <p className="ui-kicker">{`${t('app.name')} / ${t('hub.kicker')}`}</p>
        <h1 ref={heading} tabIndex={-1}>
          {t('hub.title')}
        </h1>
        <p className="gv-hub__lead">{t('hub.lead')}</p>
        <p className="gv-hub__status">
          {left === null ? (
            <StatusPill tone="live">{t('hub.expiresAt', { minutes: ROOM_MINUTES })}</StatusPill>
          ) : left > 0 ? (
            <StatusPill tone="live">{t('hub.expires', { minutes: left })}</StatusPill>
          ) : (
            <StatusPill tone="out">{t('hub.expired')}</StatusPill>
          )}
        </p>
      </header>

      <div className="gv-hub__grid">
        <Step n={1} title={t('hub.step1')} hint={t('hub.step1Hint')}>
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
        </Step>

        <Step n={2} title={t('hub.step2')} hint={t('hub.step2Hint')}>
          <div className="gv-hub__join">
            <div>
              <p className="ui-kicker">{t('hub.codeLabel')}</p>
              <Flaps code={code} />
            </div>
            <div className="gv-flow__qr gv-hub__qr" role="group" aria-label={t('hub.qrLabel')}>
              <Suspense fallback={null}>
                <QrCode url={qrTarget} size={176} />
              </Suspense>
            </div>
          </div>
          <div className="gv-hub__row">
            {code !== null && (
              <Button variant="outline" onClick={() => copy('code', code)}>
                {copied === 'code' ? t('generic.copied') : t('hub.copyCode')}
              </Button>
            )}
            <Button variant="outline" onClick={() => copy('invite', qrTarget)}>
              {copied === 'invite' ? t('generic.copied') : t('hub.copyInvite')}
            </Button>
          </div>
        </Step>

        <Step n={3} title={t('hub.step3')} hint={t('hub.step3Hint')}>
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
        </Step>

        <Step n={4} title={t('hub.step4')} hint={t('hub.step4Hint')}>
          {bidderLink !== null ? (
            <a className="gv-flow__action" href={bidderLink} target="_blank" rel="noopener">
              {t('hub.step4Open')}
              <span className="gv-visually-hidden">{newTab}</span>
            </a>
          ) : keys.auctioneer === null ? (
            <p className="gv-hub__missing">{t('hub.noInviteToken')}</p>
          ) : invite.kind === 'failed' ? (
            <p className="gv-hub__missing" role="alert">
              {t('hub.inviteFailed')}
            </p>
          ) : (
            <p className="gv-hub__pending" role="status">
              {t('hub.inviteBusy')}
            </p>
          )}
          {keys.auctioneer !== null && (
            <Button variant="outline" disabled={invite.kind === 'busy'} onClick={makeInvite}>
              {t('hub.newInvite')}
            </Button>
          )}
        </Step>
      </div>

      <aside className="gv-hub__test" aria-labelledby="gv-hub-test">
        <h2 id="gv-hub-test">{t('hub.testTitle')}</h2>
        <ol>
          <li>{t('hub.test1')}</li>
          <li>{t('hub.test2')}</li>
          <li>{t('hub.test3')}</li>
          <li>{t('hub.test4')}</li>
          <li>{t('hub.test5')}</li>
        </ol>
        <p className="gv-hub__note">{t('hub.expiresAt', { minutes: ROOM_MINUTES })}</p>
        <div className="gv-hub__row">
          <Button onClick={() => copy('all', shareText)}>
            {copied === 'all' ? t('hub.shareCopied') : t('hub.shareAll')}
          </Button>
          <a className="gv-flow__action gv-flow__action--plain" href="/demo">
            {t('hub.newDemo')}
          </a>
        </div>
      </aside>
    </main>
  );
}

export default JudgeHub;
