import { useEffect, useRef, useState } from 'react';
import { WideAside } from '../WideAside';
import { t } from '../../copy/t';
import { waitText } from '../../net/apiError';
import { Provenance } from '../../design/Provenance';
import { Button } from '../../design/primitives/Button';
import { Dialog } from '../../design/primitives/Dialog';
import { Field } from '../../design/primitives/Field';
import { parseGoalInput } from '../screen/fundraiser';
import { GoalField } from './GoalField';
import '../flows.css';
import './demo.css';

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
export type DemoFailure = 'demoOff' | 'unauthorized' | 'roomCap' | 'judgeBusy' | 'rateLimited';

/** Rejection from `createRoom` when the server answered with a known refusal. */
export class DemoRoomError extends Error {
  readonly reason: DemoFailure;
  /** Seconds the server asked the client to wait, when it said. */
  readonly retryAfterS: number | null;
  constructor(reason: DemoFailure, retryAfterS: number | null = null) {
    super(reason);
    this.reason = reason;
    this.retryAfterS = retryAfterS;
  }
}

export function failureText(reason: DemoFailure | null, retryAfterS: number | null = null): string {
  if (reason === 'rateLimited') {
    return retryAfterS === null
      ? t('demo.failedRateUnknown')
      : t('demo.failedRate', { wait: waitText(retryAfterS) });
  }
  if (reason === 'demoOff') return t('demo.failedOff');
  if (reason === 'unauthorized') return t('demo.failedKey');
  if (reason === 'roomCap') return t('demo.failedCap');
  if (reason === 'judgeBusy') return t('demo.failedBusy');
  return t('demo.failed');
}

export interface DemoLauncherProps {
  /** Creates a room on the server. Rejects when the server cannot be reached. */
  readonly createRoom: (goalCents?: number) => Promise<DemoLinks>;
  /** Shows the optional fundraiser goal field. Only hosts that take a goal at creation set this. */
  readonly goalField?: boolean;
  /** Starts the local scripted room (ScenarioTransport) and returns its links. */
  readonly startScripted: () => DemoLinks;
  /** Opens the console in the current tab. */
  readonly openConsole: (href: string) => void;
  /** Starts in scripted mode, for `transport=scenario`. */
  readonly initialMode?: DemoMode;
  /** Goes to a room by its code. Defaults to `openConsole`, which navigates in the current tab. */
  readonly openRoom?: (href: string) => void;
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
  goalField = false,
  startScripted,
  openConsole,
  initialMode = 'live',
  openRoom = openConsole,
  writeClipboard = (text) => navigator.clipboard.writeText(text),
}: DemoLauncherProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const starting = useRef(false);
  useEffect(() => {
    document.title = t('landing.start');
    heading.current?.focus();
  }, []);
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<DemoMode>(initialMode);
  const [links, setLinks] = useState<DemoLinks | null>(null);
  const [copied, setCopied] = useState<RoleKey | null>(null);
  const [failure, setFailure] = useState<DemoFailure | null>(null);
  const [goal, setGoal] = useState('');
  const goalInput = parseGoalInput(goal);
  const goalOk = !goalField || goalInput.kind === 'empty' || goalInput.kind === 'ok';
  const [retryAfterS, setRetryAfterS] = useState<number | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === 'failed') errorBox.current?.focus();
  }, [phase]);

  const goToRoom = (event: React.FormEvent): void => {
    event.preventDefault();
    const clean = code.trim();
    if (clean === '') {
      setCodeError(t('demo.codeEmpty'));
    } else if (!/^[A-Za-z0-9_-]{1,64}$/.test(clean)) {
      setCodeError(t('demo.codeBad'));
    } else {
      setCodeError(undefined);
      setCodeOpen(false);
      openRoom(`/join/${encodeURIComponent(clean)}`);
    }
  };

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
    if (!goalOk || starting.current) return;
    // A ref, not state: two clicks in one frame must not both send a request.
    starting.current = true;
    setPhase('busy');
    setFailure(null);
    setRetryAfterS(null);
    createRoom(goalField && goalInput.kind === 'ok' ? goalInput.cents : undefined).then(
      (next) => {
        starting.current = false;
        finish(next, 'live');
      },
      (error: unknown) => {
        starting.current = false;
        setFailure(error instanceof DemoRoomError ? error.reason : null);
        setRetryAfterS(error instanceof DemoRoomError ? error.retryAfterS : null);
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
      <p className="ui-kicker">{t('app.name')}</p>
      <h1 ref={heading} tabIndex={-1}>
        {t('landing.start')}
      </h1>
      <p className="gv-demo__lead">{t('demo.lead')}</p>
      <Provenance kind={mode} />
      <section className="gv-demo__start" aria-busy={phase === 'busy'}>
        {goalField && mode === 'live' && <GoalField value={goal} onChange={setGoal} />}
        <Button
          size="bid"
          disabled={phase === 'busy' || (mode === 'live' && !goalOk)}
          onClick={start}
        >
          {phase === 'busy' ? t('demo.creating') : t('landing.start')}
        </Button>
        {phase === 'busy' && (
          <p className="gv-demo__status" role="status">
            {t('demo.creatingStatus')}
          </p>
        )}
      </section>
      {phase === 'failed' && (
        <div ref={errorBox} className="gv-flow__error" role="alert" tabIndex={-1}>
          <p>{failureText(failure, retryAfterS)}</p>
          <Button variant="outline" onClick={scripted}>
            {t('demo.scriptedInstead')}
          </Button>
        </div>
      )}
      {links === null && (
        <section className="gv-demo__gets" aria-labelledby="gv-demo-gets">
          <h2 id="gv-demo-gets">{t('demo.steps')}</h2>
          <ul>
            <li>{t('demo.stepConsole')}</li>
            <li>{t('demo.stepScreen')}</li>
            <li>{t('demo.stepBidder')}</li>
          </ul>
        </section>
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
      <nav className="gv-demo__ways" aria-labelledby="gv-demo-ways">
        <h2 id="gv-demo-ways">{t('demo.otherWays')}</h2>
        <ul>
          <li>
            <a href="/demo/scripted">{t('demo.tour')}</a>
            <span>{t('demo.tourHint')}</span>
          </li>
          <li>
            <a href="/try">{t('demo.judge')}</a>
            <span>{t('demo.judgeHint')}</span>
          </li>
          <li>
            <button type="button" className="gv-demo__linkbtn" onClick={() => setCodeOpen(true)}>
              {t('demo.haveCode')}
            </button>
          </li>
        </ul>
      </nav>
      <WideAside />
      <Dialog open={codeOpen} onClose={() => setCodeOpen(false)} title={t('demo.codeTitle')}>
        <form className="gv-demo__code" onSubmit={goToRoom} noValidate>
          <h2>{t('demo.codeTitle')}</h2>
          <Field
            label={t('demo.codeLabel')}
            hint={t('demo.codeHint')}
            {...(codeError === undefined ? {} : { error: codeError })}
            value={code}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            onChange={(e) => setCode(e.target.value)}
          />
          <div className="gv-demo__code-actions">
            <Button type="submit">{t('demo.codeGo')}</Button>
            <Button type="button" variant="outline" onClick={() => setCodeOpen(false)}>
              {t('generic.close')}
            </Button>
          </div>
        </form>
      </Dialog>
    </main>
  );
}

export default DemoLauncher;
