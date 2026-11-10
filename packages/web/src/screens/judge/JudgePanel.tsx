import { Instructor } from '../../help';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { t } from '../../copy/t';
import { Icon, type IconName } from '../../design/icons';
import { Button } from '../../design/primitives/Button';
import { Chip, type ChipTone } from '../../design/primitives/Chip';
import { Field } from '../../design/primitives/Field';
import {
  forgetJudgeKey,
  JUDGE_KEY_MAX_CHARS,
  readJudgeKey,
  rememberJudgeKey,
  type JudgeKeyResult,
} from '../../net/judgeKey';
import type { JudgeRoomsStatus, LedgerFetch } from '../../net/judgeRooms';
import { SCRIPTED_DEMO_PATH } from '../../net/scriptedMode';
import { JoinCodeInput } from '../../ui';
import { DemoRoomError, failureText, type DemoFailure, type DemoLinks } from '../demo/DemoLauncher';
import { GoalField } from '../demo/GoalField';
import { parseGoalInput } from '../screen/fundraiser';
import { lookupProblemText } from '../../net/apiError';
import { REPO_URL } from '../landing/LandingSections';
import { latestHubRoom } from '../hub/hubKeys';
import '../flows.css';
import { EvidenceColumn } from './EvidenceColumn';
import { JudgeDialog, type JudgeTab } from './JudgeDialog';
import { JudgeStage } from './JudgeStage';
import { liveRoomFrom, type LiveRoom } from './liveRoom';
import { RoomCard } from './RoomCard';
import { useDemoScript } from './useDemoScript';
import './judge.css';

/** What the panel knows about live rooms: the host's answer, or why there is none. */
export type RoomsState = 'checking' | 'noServer' | JudgeRoomsStatus;

/**
 * Publishes the floating action bar's real height (and its bottom offset) as `--judge-bar-clear`
 * on the root element, so the page pads its end and scrolls focused controls clear of the bar
 * whatever the viewport or wrapping makes of it.
 */
export function useDockClearance(bar: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = bar.current;
    const root = document.documentElement;
    if (el === null) return undefined;
    const measure = (): void => {
      const { height } = el.getBoundingClientRect();
      if (height > 0) root.style.setProperty('--judge-bar-clear', `${Math.ceil(height) + 40}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--judge-bar-clear');
    };
  }, [bar]);
}

export interface JudgePanelProps {
  readonly rooms: RoomsState;
  /**
   * Creates a sandbox room, with a fundraiser goal in cents when one was typed and the judge key
   * when the visitor unlocked one. Rejects with a `DemoRoomError` when the host refuses.
   */
  readonly createRoom: (goalCents?: number, judgeKey?: string) => Promise<DemoLinks>;
  /** Opens a page in the current tab. */
  readonly openRoom: (href: string) => void;
  /** Looks a room code up and goes to the join page. Resolves false when there is no such room. */
  readonly joinByCode: (code: string) => Promise<boolean>;
  /** The visitor's live room. Defaults to the newest room this tab holds keys for. */
  readonly room?: LiveRoom | null;
  /** Turns the simulated run's own timer off, for tests that read one frame. */
  readonly autoplay?: boolean;
  /** True when the host has a judge key set. Without it the key field is not shown at all. */
  readonly keyOffered?: boolean;
  /** Asks the host whether a key is right, without making a room. */
  readonly checkKey?: (key: string) => Promise<JudgeKeyResult>;
  /** The API base, for the ledger check of the visitor's room. */
  readonly apiBase?: string | undefined;
  readonly loadLedger?: (apiBase: string, roomId: string, token: string) => Promise<LedgerFetch>;
}

const CODE_LENGTH = 6;
const CODE_PREFIX = 'GVL-';

const STATUS: Readonly<
  Record<
    RoomsState,
    {
      readonly key:
        | 'try.status.checking'
        | 'try.status.on'
        | 'try.status.busy'
        | 'try.status.off'
        | 'try.status.unreachable'
        | 'try.status.noServer';
      readonly tone: ChipTone;
      readonly icon: IconName;
    }
  >
> = {
  checking: { key: 'try.status.checking', tone: 'neutral', icon: 'clock' },
  on: { key: 'try.status.on', tone: 'success', icon: 'check' },
  busy: { key: 'try.status.busy', tone: 'warning', icon: 'warning' },
  off: { key: 'try.status.off', tone: 'warning', icon: 'warning' },
  unreachable: { key: 'try.status.unreachable', tone: 'danger', icon: 'warning' },
  noServer: { key: 'try.status.noServer', tone: 'neutral', icon: 'hollow' },
};

/** Start a room is blocked only when the host cannot make one; a full host may free a slot soon. */
function canStart(rooms: RoomsState): boolean {
  return rooms !== 'noServer' && rooms !== 'off';
}

/**
 * The judge page at /try: a masthead, one headline, three numbered moves (start, join, judge
 * tools) beside Fig. 1 (a simulated run on an auction stage) and an evidence band. Nothing on it
 * is live except the server status, the links and a room code the visitor already holds.
 */
export function JudgePanel({
  rooms,
  createRoom,
  openRoom,
  joinByCode,
  room: roomProp,
  autoplay = true,
  keyOffered = false,
  checkKey,
  apiBase,
  loadLedger,
}: JudgePanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const bar = useRef<HTMLElement>(null);
  useDockClearance(bar);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [failure, setFailure] = useState<DemoFailure | null>(null);
  const [code, setCode] = useState('');
  const [looking, setLooking] = useState(false);
  const [missing, setMissing] = useState(false);
  const [retryAfterS, setRetryAfterS] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const goalInput = parseGoalInput(goal);
  const goalOk = goalInput.kind === 'empty' || goalInput.kind === 'ok';
  const [dialog, setDialog] = useState<JudgeTab | null>(null);
  // The key lives in this tab's sessionStorage and in this state, never in a URL or a link.
  const [heldKey, setHeldKey] = useState<string | null>(() => (keyOffered ? readJudgeKey() : null));
  const [keyInput, setKeyInput] = useState('');
  const [keyState, setKeyState] = useState<'idle' | 'checking' | JudgeKeyResult>('idle');
  const unlocked = keyOffered && heldKey !== null;
  const [ownRoom] = useState<LiveRoom | null>(() => liveRoomFrom(latestHubRoom()));
  const room = roomProp === undefined ? ownRoom : roomProp;
  const script = useDemoScript(autoplay);
  const running = script.state.status === 'running';

  useEffect(() => {
    document.title = t('try.title');
    heading.current?.focus();
  }, []);

  const status = STATUS[rooms];
  const startable = canStart(rooms);

  const start = (): void => {
    if (phase === 'busy' || !startable || !goalOk) return;
    setPhase('busy');
    setFailure(null);
    setRetryAfterS(null);
    const goalCents = goalInput.kind === 'ok' ? goalInput.cents : undefined;
    (keyOffered && heldKey !== null ? createRoom(goalCents, heldKey) : createRoom(goalCents)).then(
      (links) => openRoom(links.hub ?? links.console),
      (error: unknown) => {
        const reason = error instanceof DemoRoomError ? error.reason : null;
        // A key the host no longer accepts is dropped, so the visitor can type a new one.
        if (reason === 'keyWrong') {
          forgetJudgeKey();
          setHeldKey(null);
        }
        setFailure(reason);
        setRetryAfterS(error instanceof DemoRoomError ? error.retryAfterS : null);
        setPhase('failed');
      },
    );
  };

  const unlock = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const typed = keyInput.trim();
    if (typed === '' || keyState === 'checking' || checkKey === undefined) return;
    setKeyState('checking');
    checkKey(typed).then(
      (result) => {
        setKeyState(result);
        if (result === 'ok') {
          rememberJudgeKey(typed);
          setHeldKey(typed);
          setKeyInput('');
        }
      },
      () => setKeyState('unreachable'),
    );
  };

  const lock = (): void => {
    forgetJudgeKey();
    setHeldKey(null);
    setKeyState('idle');
  };

  const keyMessage =
    keyState === 'wrong'
      ? t('try.key.wrong')
      : keyState === 'locked'
        ? t('try.key.locked')
        : keyState === 'unreachable'
          ? t('try.key.unreachable')
          : null;

  const find = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed === '' || looking) return;
    // Without a server the join page is the only place that can answer, so go straight there.
    if (rooms === 'noServer') {
      openRoom(`/join/${encodeURIComponent(trimmed)}`);
      return;
    }
    setLooking(true);
    joinByCode(trimmed)
      .then((found) => {
        setProblem(null);
        setMissing(!found);
      })
      .catch((error: unknown) => {
        setProblem(lookupProblemText(error));
        setMissing(true);
      })
      .finally(() => setLooking(false));
  };

  const view = (
    tab: 'console' | 'screen' | 'receipt',
    label: 'try.a3.console' | 'try.a3.screen' | 'try.a3.receipt',
  ) => {
    const href = room === null ? null : room[tab];
    return href !== null ? (
      <a className="gv-judge__linkbtn gv-judge__linkbtn--alt" href={href}>
        {t(label)}
      </a>
    ) : (
      <Button variant="outline" onClick={() => setDialog(tab)}>
        {t(label)}
      </Button>
    );
  };

  const scriptPrimary = !startable && rooms !== 'checking';

  const scriptLink = (
    <a
      key="script"
      className={`gv-judge__linkbtn${scriptPrimary ? '' : ' gv-judge__linkbtn--alt'}`}
      href={SCRIPTED_DEMO_PATH}
    >
      {t('try.a1.script')}
    </a>
  );
  const startButton = (
    <Button
      key="start"
      size="bid"
      variant={scriptPrimary ? 'outline' : 'solid'}
      disabled={phase === 'busy' || !startable || !goalOk}
      onClick={start}
    >
      {phase === 'busy' ? t('try.a1.creating') : t('try.a1.room')}
    </Button>
  );

  return (
    <main className="gv-judge" data-route="try">
      <a className="gv-judge__skip" href="#gv-judge-main">
        {t('try.skip')}
      </a>
      <div className="gv-judge__strip">
        <div className="gv-judge__page gv-judge__stripin">
          <span>{t('try.edition')}</span>
          <span className="gv-judge__status" role="status" data-rooms={rooms}>
            <Chip
              state={rooms}
              label={t(status.key)}
              tone={status.tone}
              icon={<Icon name={status.icon} />}
            />
          </span>
        </div>
      </div>
      <header className="gv-judge__page gv-judge__mast">
        <p className="gv-judge__brand">{t('try.brand')}</p>
        <div className="gv-judge__mastside">
          <p className="gv-judge__tagline">{t('try.tagline')}</p>
          <p className="gv-judge__meta">
            <span>{t('try.strip1')}</span>
            <span>{t('try.strip2')}</span>
            <span>{t('try.editionNote')}</span>
          </p>
        </div>
      </header>

      <div className="gv-judge__page gv-judge__grid" id="gv-judge-main">
        <div className="gv-judge__left">
          <section className="gv-judge__headline" aria-labelledby="gv-judge-h1">
            <p className="gv-judge__kicker">{t('try.kicker')}</p>
            <h1 id="gv-judge-h1" ref={heading} tabIndex={-1}>
              {t('try.hl1')} <mark>{t('try.hl2')}</mark> {t('try.hl3')} <mark>{t('try.hl4')}</mark>
            </h1>
            <p className="gv-judge__deck">{t('try.deck')}</p>
            <p className="gv-judge__by">{t('try.by')}</p>
          </section>

          <Instructor screen="try" judge current={0} />

          <section className="gv-judge__acts" aria-labelledby="gv-judge-acts">
            <h2 id="gv-judge-acts" className="gv-judge__rule">
              {t('try.acts.title')}
            </h2>

            <article className="gv-judge__col gv-judge__col--start" aria-labelledby="gv-judge-a1">
              <header className="gv-judge__colhead">
                <span className="gv-judge__num" aria-hidden="true">
                  {1}
                </span>
                <div>
                  <h3 id="gv-judge-a1">{t('try.a1.title')}</h3>
                  <p className="gv-judge__tag">{t('try.a1.tag')}</p>
                </div>
              </header>
              <p className="gv-judge__lead">{t('try.a1.body')}</p>
              <div className="gv-judge__stack">
                {scriptPrimary ? [scriptLink, startButton] : [startButton, scriptLink]}
              </div>
              {(phase === 'failed' || (!startable && rooms !== 'checking')) && (
                <div className="gv-flow__error" role="alert">
                  <p>
                    {phase === 'failed'
                      ? `${t('try.a1.failed')} ${failureText(failure, retryAfterS)}`
                      : t('try.a1.open')}
                  </p>
                </div>
              )}
              <details className="gv-judge__more" {...(keyOffered ? { open: true } : {})}>
                <summary>{t('try.help.opts')}</summary>
                <div className="gv-judge__morebody">
                  <GoalField value={goal} onChange={setGoal} />
                  {keyOffered && (
                    <div className="gv-judge__key" data-unlocked={unlocked}>
                      {unlocked ? (
                        <>
                          <p className="gv-judge__note" role="status">
                            {t('try.key.active')}
                          </p>
                          <Button variant="outline" onClick={lock}>
                            {t('try.key.forget')}
                          </Button>
                        </>
                      ) : (
                        <form onSubmit={unlock}>
                          <Field
                            label={t('try.key.label')}
                            hint={t('try.key.hint')}
                            type="password"
                            name="judge-key"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            maxLength={JUDGE_KEY_MAX_CHARS}
                            value={keyInput}
                            onChange={(e) => {
                              setKeyInput(e.target.value);
                              if (keyState !== 'checking') setKeyState('idle');
                            }}
                            {...(keyMessage === null ? {} : { error: keyMessage })}
                          />
                          <Button
                            type="submit"
                            variant="outline"
                            disabled={keyState === 'checking' || keyInput.trim() === ''}
                          >
                            {keyState === 'checking' ? t('try.key.checking') : t('try.key.unlock')}
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              </details>
            </article>

            <article className="gv-judge__col" aria-labelledby="gv-judge-a2">
              <header className="gv-judge__colhead">
                <span className="gv-judge__num" aria-hidden="true">
                  {2}
                </span>
                <div>
                  <h3 id="gv-judge-a2">{t('try.a2.title')}</h3>
                  <p className="gv-judge__tag">{t('try.a2.tag')}</p>
                </div>
              </header>
              <div className="gv-judge__joinrow">
                <form className="gv-judge__join" onSubmit={find}>
                  <JoinCodeInput
                    value={code}
                    length={CODE_LENGTH}
                    prefix={CODE_PREFIX}
                    disabled={looking}
                    invalid={missing}
                    {...(missing ? { message: problem ?? t('landing.codeInvalid') } : {})}
                    onChange={(next) => {
                      setCode(next);
                      setMissing(false);
                      setProblem(null);
                    }}
                  />
                  <Button type="submit" variant="outline" disabled={looking || code.trim() === ''}>
                    {looking ? t('try.a2.checking') : t('try.a2.go')}
                  </Button>
                </form>
                <RoomCard room={room} id="gv-judge-room-side" />
              </div>
              <details className="gv-judge__more">
                <summary>{t('try.help.more')}</summary>
                <div className="gv-judge__morebody">
                  <p>{t('try.a2.body')}</p>
                  <p className="gv-judge__note">{t('try.a2.nocode')}</p>
                </div>
              </details>
            </article>

            <article className="gv-judge__col" aria-labelledby="gv-judge-a3">
              <header className="gv-judge__colhead">
                <span className="gv-judge__num" aria-hidden="true">
                  {3}
                </span>
                <div>
                  <h3 id="gv-judge-a3">{t('try.a3.title')}</h3>
                  <p className="gv-judge__tag">{t('try.a3.tag')}</p>
                </div>
              </header>
              <div className="gv-judge__row">
                {view('console', 'try.a3.console')}
                {view('screen', 'try.a3.screen')}
                {view('receipt', 'try.a3.receipt')}
                <Button variant="outline" onClick={() => setDialog('verify')}>
                  {t('try.tab.verify')}
                </Button>
              </div>
              <details className="gv-judge__more">
                <summary>{t('try.help.more')}</summary>
                <div className="gv-judge__morebody">
                  <p>{t('try.a3.body')}</p>
                </div>
              </details>
            </article>
          </section>
        </div>

        <div className="gv-judge__right">
          <JudgeStage state={script.state} />
          <blockquote className="gv-judge__quote">
            <p>{t('try.quote')}</p>
            <cite>{t('try.quoteCite')}</cite>
          </blockquote>
        </div>
      </div>

      <div className="gv-judge__page">
        <EvidenceColumn />
      </div>

      <footer className="gv-judge__page gv-judge__foot">
        <span>{t('try.foot')}</span>
        <span>{t('try.footNote')}</span>
        <span className="gv-judge__footlinks">
          <a className="ui-link" href={REPO_URL}>
            {t('try.more.repo')}
          </a>
          <a className="ui-link" href="/">
            {t('try.more.landing')}
          </a>
        </span>
      </footer>

      <nav ref={bar} className="gv-judge__bar" aria-label={t('try.bar.label')}>
        <Button
          size="bid"
          variant="outline"
          className="gv-judge__go"
          disabled={running}
          onClick={script.run}
        >
          <span>
            {running
              ? t('try.run.running')
              : script.state.status === 'idle'
                ? t('try.run.go')
                : t('try.run.replay')}
          </span>
          <small>{t('try.run.sub')}</small>
        </Button>
        <Button size="bid" variant="outline" onClick={() => setDialog('join')}>
          <span>{t('try.bar.join')}</span>
          <small>{t('try.bar.joinSub')}</small>
        </Button>
        <Button size="bid" variant="outline" onClick={() => setDialog('console')}>
          <span>{t('try.bar.console')}</span>
          <small>{t('try.bar.consoleSub')}</small>
        </Button>
        <Button size="bid" variant="outline" onClick={() => setDialog('screen')}>
          <span>{t('try.bar.screen')}</span>
          <small>{t('try.bar.screenSub')}</small>
        </Button>
      </nav>

      <JudgeDialog
        open={dialog !== null}
        tab={dialog ?? 'join'}
        onTab={setDialog}
        onClose={() => setDialog(null)}
        room={room}
        apiBase={apiBase}
        {...(loadLedger === undefined ? {} : { loadLedger })}
      />
    </main>
  );
}

export default JudgePanel;
