import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { t } from '../../copy/t';
import { Icon, type IconName } from '../../design/icons';
import { Button } from '../../design/primitives/Button';
import { Chip, type ChipTone } from '../../design/primitives/Chip';
import type { JudgeRoomsStatus } from '../../net/judgeRooms';
import { SCRIPTED_DEMO_PATH, SCRIPTED_JOIN_PATH } from '../../net/scriptedMode';
import { JoinCodeInput } from '../../ui';
import { DemoRoomError, failureText, type DemoFailure, type DemoLinks } from '../demo/DemoLauncher';
import { GoalField } from '../demo/GoalField';
import { parseGoalInput } from '../screen/fundraiser';
import { DOCS_URL, REPO_URL, Section, TrustSection } from '../landing/LandingSections';
import '../flows.css';
import '../landing/landing.css';
import './judge.css';

/** What the panel knows about live rooms: the host's answer, or why there is none. */
export type RoomsState = 'checking' | 'noServer' | JudgeRoomsStatus;

export interface JudgePanelProps {
  readonly rooms: RoomsState;
  /**
   * Creates a key-less sandbox room, with a fundraiser goal in cents when the host typed one.
   * Rejects with a `DemoRoomError` when the host refuses.
   */
  readonly createRoom: (goalCents?: number) => Promise<DemoLinks>;
  /** Opens the room page in the current tab. */
  readonly openRoom: (href: string) => void;
  /** Looks a room code up and goes to the join page. Resolves false when there is no such room. */
  readonly joinByCode: (code: string) => Promise<boolean>;
}

const CODE_LENGTH = 6;

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

const BEATS = [
  { title: 'try.beat1.title', body: 'try.beat1.body' },
  { title: 'try.beat2.title', body: 'try.beat2.body' },
  { title: 'try.beat3.title', body: 'try.beat3.body' },
] as const;

const SCREENS = [
  { name: 'try.screens.room', who: 'try.screens.roomFor', how: 'try.screens.roomHow' },
  {
    name: 'try.screens.projection',
    who: 'try.screens.projectionFor',
    how: 'try.screens.projectionHow',
  },
  { name: 'try.screens.bidder', who: 'try.screens.bidderFor', how: 'try.screens.bidderHow' },
  { name: 'try.screens.console', who: 'try.screens.consoleFor', how: 'try.screens.consoleHow' },
  { name: 'try.screens.audit', who: 'try.screens.auditFor', how: 'try.screens.auditHow' },
] as const;

const BUYER_STEPS = [
  'try.buyer.step1',
  'try.buyer.step2',
  'try.buyer.step3',
  'try.buyer.step4',
] as const;

const FAQ = [
  { q: 'try.faq.q1', a: 'try.faq.a1' },
  { q: 'try.faq.q2', a: 'try.faq.a2' },
  { q: 'try.faq.q3', a: 'try.faq.a3' },
  { q: 'try.faq.q4', a: 'try.faq.a4' },
  { q: 'try.faq.q5', a: 'try.faq.a5' },
  { q: 'try.faq.q6', a: 'try.faq.a6' },
] as const;

/** Start a room is blocked only when the host cannot make one; a full host may free a slot soon. */
function canStart(rooms: RoomsState): boolean {
  return rooms !== 'noServer' && rooms !== 'off';
}

function StepCard({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = `gv-judge-step-${n}`;
  return (
    <li className="gv-judge__step" aria-labelledby={id}>
      <span className="gv-judge__num" aria-hidden="true">
        {n}
      </span>
      <div className="gv-judge__stepbody">
        <p className="ui-kicker">{t('try.step', { n })}</p>
        <h3 id={id}>{title}</h3>
        {children}
      </div>
    </li>
  );
}

/** The judge's landing page: a guided path from the 20 second pitch to receipt and audit trail. */
export function JudgePanel({ rooms, createRoom, openRoom, joinByCode }: JudgePanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [failure, setFailure] = useState<DemoFailure | null>(null);
  const [code, setCode] = useState('');
  const [looking, setLooking] = useState(false);
  const [missing, setMissing] = useState(false);
  const [goal, setGoal] = useState('');
  const goalInput = parseGoalInput(goal);
  const goalOk = goalInput.kind === 'empty' || goalInput.kind === 'ok';

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
    createRoom(goalInput.kind === 'ok' ? goalInput.cents : undefined).then(
      (links) => openRoom(links.hub ?? links.console),
      (error: unknown) => {
        setFailure(error instanceof DemoRoomError ? error.reason : null);
        setPhase('failed');
      },
    );
  };

  const find = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed === '' || looking || rooms === 'noServer') return;
    setLooking(true);
    joinByCode(trimmed)
      .then((found) => setMissing(!found))
      .catch(() => setMissing(true))
      .finally(() => setLooking(false));
  };

  return (
    <main className="gv-judge" data-route="try">
      <header className="gv-judge__head">
        <p className="ui-kicker">{t('try.kicker')}</p>
        <h1 ref={heading} tabIndex={-1}>
          {t('try.title')}
        </h1>
        <p className="gv-judge__lead">{t('try.lead')}</p>
        <div role="status" className="gv-judge__status" data-rooms={rooms}>
          <Chip
            state={rooms}
            label={t(status.key)}
            tone={status.tone}
            icon={<Icon name={status.icon} />}
          />
        </div>
        <nav className="gv-judge__nav" aria-label={t('try.nav.label')}>
          <a href="#path">{t('try.nav.path')}</a>
          <a href="#screens">{t('try.nav.screens')}</a>
          <a href="#buyer">{t('try.nav.buyer')}</a>
          <a href="#trust">{t('try.nav.trust')}</a>
          <a href="#faq">{t('try.nav.faq')}</a>
        </nav>
      </header>

      <Section id="pitch" title={t('try.pitch.title')} lead={t('try.pitch.lead')}>
        <ol className="gv-judge__beats">
          {BEATS.map((beat, i) => (
            <li key={beat.title} className="gv-judge__beat">
              <span className="gv-judge__beatn" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{t(beat.title)}</h3>
              <p>{t(beat.body)}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="path" title={t('try.path.title')} lead={t('try.path.lead')}>
        <ol className="gv-judge__steps">
          <StepCard n={1} title={t('try.s1.title')}>
            <p>{t('try.s1.body')}</p>
            <GoalField value={goal} onChange={setGoal} />
            <Button size="bid" disabled={phase === 'busy' || !startable || !goalOk} onClick={start}>
              {phase === 'busy' ? t('try.s1.creating') : t('try.s1.cta')}
            </Button>
            {(phase === 'failed' || (!startable && rooms !== 'checking')) && (
              <div className="gv-flow__error" role="alert">
                <p>
                  {phase === 'failed'
                    ? `${t('try.s1.failed')} ${failureText(failure)}`
                    : t('try.s1.open')}
                </p>
                <a className="gv-flow__action" href={SCRIPTED_DEMO_PATH}>
                  {t('demo.scriptedInstead')}
                </a>
              </div>
            )}
          </StepCard>

          <StepCard n={2} title={t('try.s2.title')}>
            <p>{t('try.s2.body')}</p>
            <form className="gv-judge__join" onSubmit={find}>
              <JoinCodeInput
                value={code}
                length={CODE_LENGTH}
                prefix=""
                disabled={looking || rooms === 'noServer'}
                invalid={missing}
                {...(missing ? { message: t('landing.codeInvalid') } : {})}
                onChange={(next) => {
                  setCode(next);
                  setMissing(false);
                }}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={looking || code.trim() === '' || rooms === 'noServer'}
              >
                {looking ? t('try.s2.checking') : t('try.s2.go')}
              </Button>
            </form>
            {rooms === 'noServer' && <p className="gv-judge__note">{t('try.s2.noServer')}</p>}
          </StepCard>

          <StepCard n={3} title={t('try.s3.title')}>
            <p>{t('try.s3.body')}</p>
            <a className="gv-flow__action gv-flow__action--plain" href="#buyer">
              {t('try.nav.buyer')}
            </a>
          </StepCard>

          <StepCard n={4} title={t('try.s4.title')}>
            <p>{t('try.s4.body')}</p>
          </StepCard>

          <StepCard n={5} title={t('try.s5.title')}>
            <p>{t('try.s5.body')}</p>
            <ol className="gv-judge__flow" aria-label={t('try.flow.label')}>
              <li>{t('try.flow.hold')}</li>
              <li>{t('try.flow.hammer')}</li>
              <li>{t('try.flow.receipt')}</li>
            </ol>
          </StepCard>
        </ol>

        <aside className="gv-judge__script" aria-labelledby="gv-judge-script">
          <h3 id="gv-judge-script">{t('try.script.title')}</h3>
          <p>{t('try.script.body')}</p>
          <div className="gv-judge__actions">
            <a className="gv-flow__action" href={SCRIPTED_DEMO_PATH}>
              {t('try.script.run')}
            </a>
            <a className="gv-flow__action gv-flow__action--plain" href={SCRIPTED_JOIN_PATH}>
              {t('try.script.join')}
            </a>
          </div>
        </aside>
      </Section>

      <Section id="screens" title={t('try.screens.title')} lead={t('try.screens.lead')}>
        <div className="gv-judge__tablewrap">
          <table className="gv-judge__table">
            <caption className="gv-visually-hidden">{t('try.screens.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('try.screens.colScreen')}</th>
                <th scope="col">{t('try.screens.colFor')}</th>
                <th scope="col">{t('try.screens.colHow')}</th>
              </tr>
            </thead>
            <tbody>
              {SCREENS.map((row) => (
                <tr key={row.name}>
                  <th scope="row">{t(row.name)}</th>
                  <td>{t(row.who)}</td>
                  <td>{t(row.how)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="gv-judge__key" aria-labelledby="gv-judge-key">
          <h3 id="gv-judge-key">
            <span aria-hidden="true">
              <Icon name="lock" />
            </span>{' '}
            {t('try.key.title')}
          </h3>
          <p>{t('try.key.body')}</p>
        </aside>
      </Section>

      <Section id="buyer" title={t('try.buyer.title')} lead={t('try.buyer.lead')}>
        <ol className="gv-judge__buyer">
          {BUYER_STEPS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>
        <p className="gv-judge__warn">
          <span aria-hidden="true">
            <Icon name="warning" />
          </span>{' '}
          {t('try.buyer.warn')}
        </p>
        <div className="gv-judge__limits">
          <h3>{t('try.limits.title')}</h3>
          <p>{t('try.limits.body')}</p>
        </div>
      </Section>

      <TrustSection />

      <Section id="faq" title={t('try.faq.title')}>
        <div className="gv-faq">
          {FAQ.map((item) => (
            <details key={item.q} className="gv-faq__item">
              <summary className="gv-faq__q">{t(item.q)}</summary>
              <p className="gv-faq__a">{t(item.a)}</p>
            </details>
          ))}
        </div>
      </Section>

      <nav className="gv-judge__more" aria-labelledby="gv-judge-more">
        <h2 id="gv-judge-more" className="ui-kicker">
          {t('try.more.title')}
        </h2>
        <ul>
          <li>
            <a className="gv-link" href={DOCS_URL}>
              {t('try.more.docs')}
            </a>
          </li>
          <li>
            <a className="gv-link" href={REPO_URL}>
              {t('try.more.repo')}
            </a>
          </li>
          <li>
            <a className="gv-link" href="/">
              {t('try.more.landing')}
            </a>
          </li>
        </ul>
      </nav>
    </main>
  );
}

export default JudgePanel;
