import { useEffect, useRef, useState } from 'react';
import { t } from '../../copy/t';
import { Provenance } from '../../design/Provenance';
import { Button } from '../../design/primitives/Button';
import '../flows.css';

export type DemoMode = 'live' | 'scripted';

export interface DemoLinks {
  readonly console: string;
  readonly screen: string;
  readonly bidder: string;
  readonly audit: string;
  /** The room hub, which a judge room opens first. Rooms without one open the console. */
  readonly hub?: string;
}

type RoleKey = Exclude<keyof DemoLinks, 'hub'>;

/** Why the server refused to make a room; the launcher shows a message for each. */
export type DemoFailure = 'demoOff' | 'unauthorized' | 'roomCap' | 'judgeBusy';

/** Rejection from `createRoom` when the server answered with a known refusal. */
export class DemoRoomError extends Error {
  readonly reason: DemoFailure;
  constructor(reason: DemoFailure) {
    super(reason);
    this.reason = reason;
  }
}

function failureText(reason: DemoFailure | null): string {
  if (reason === 'demoOff') return t('demo.failedOff');
  if (reason === 'unauthorized') return t('demo.failedKey');
  if (reason === 'roomCap') return t('demo.failedCap');
  if (reason === 'judgeBusy') return t('demo.failedBusy');
  return t('demo.failed');
}

export interface DemoLauncherProps {
  /** Creates a room on the server. Rejects when the server cannot be reached. */
  readonly createRoom: () => Promise<DemoLinks>;
  /** Starts the local scripted room (ScenarioTransport) and returns its links. */
  readonly startScripted: () => DemoLinks;
  /** Opens the console in the current tab. */
  readonly openConsole: (href: string) => void;
  /** Starts in scripted mode, for `transport=scenario`. */
  readonly initialMode?: DemoMode;
  readonly writeClipboard?: (text: string) => Promise<void>;
}

type Phase = 'idle' | 'busy' | 'failed' | 'ready';

const ROLES: ReadonlyArray<{
  key: RoleKey;
  label: 'demo.roleConsole' | 'demo.roleScreen' | 'demo.roleBidder' | 'demo.roleAudit';
}> = [
  { key: 'console', label: 'demo.roleConsole' },
  { key: 'screen', label: 'demo.roleScreen' },
  { key: 'bidder', label: 'demo.roleBidder' },
  { key: 'audit', label: 'demo.roleAudit' },
];

/** One click makes a room and shows the four role links with their provenance (R-WEB-036..038). */
export function DemoLauncher({
  createRoom,
  startScripted,
  openConsole,
  initialMode = 'live',
  writeClipboard = (text) => navigator.clipboard.writeText(text),
}: DemoLauncherProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = t('landing.start');
    heading.current?.focus();
  }, []);
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<DemoMode>(initialMode);
  const [links, setLinks] = useState<DemoLinks | null>(null);
  const [copied, setCopied] = useState<RoleKey | null>(null);
  const [failure, setFailure] = useState<DemoFailure | null>(null);

  const finish = (next: DemoLinks, how: DemoMode): void => {
    setMode(how);
    setLinks(next);
    setPhase('ready');
    openConsole(next.hub ?? next.console);
  };

  const scripted = (): void => finish(startScripted(), 'scripted');

  const start = (): void => {
    if (mode === 'scripted') {
      scripted();
      return;
    }
    setPhase('busy');
    setFailure(null);
    createRoom().then(
      (next) => finish(next, 'live'),
      (error: unknown) => {
        setFailure(error instanceof DemoRoomError ? error.reason : null);
        setPhase('failed');
      },
    );
  };

  const copy = (key: RoleKey, href: string): void => {
    writeClipboard(href).then(
      () => setCopied(key),
      () => setCopied(null),
    );
  };

  return (
    <main className="gv-demo gv-flow" data-route="demo">
      <h1 ref={heading} tabIndex={-1}>
        {t('landing.start')}
      </h1>
      <Provenance kind={mode} />
      <Button size="bid" disabled={phase === 'busy'} onClick={start}>
        {phase === 'busy' ? t('demo.creating') : t('landing.start')}
      </Button>
      {phase === 'failed' && (
        <div className="gv-flow__error" role="alert">
          <p>{failureText(failure)}</p>
          <Button variant="outline" onClick={scripted}>
            {t('demo.scriptedInstead')}
          </Button>
        </div>
      )}
      {links !== null && (
        <section aria-label={t('demo.linksTitle')}>
          <h2>{t('demo.linksTitle')}</h2>
          <ul>
            {ROLES.map((role) => (
              <li key={role.key}>
                <span>{t(role.label)}</span> <a href={links[role.key]}>{links[role.key]}</a>{' '}
                <Button variant="outline" onClick={() => copy(role.key, links[role.key])}>
                  {copied === role.key ? t('generic.copied') : t('generic.copy')}
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="outline" onClick={() => openConsole(links.console)}>
            {t('demo.openConsole')}
          </Button>
        </section>
      )}
    </main>
  );
}

export default DemoLauncher;
