import { t } from '../../copy/t';
import { formatUsd, formatUsdCompact } from '../../util/money';
import { LOT_NUMBER, type Pad, type StageState } from './judgeScript';

const STEPS = ['try.step.hold', 'try.step.bid', 'try.step.hammer', 'try.step.receipt'] as const;

type StepMark = 'todo' | 'on' | 'ok';

const CHECK = String.fromCharCode(0x2713);

function markFor(state: StageState, index: number): StepMark {
  if (state.status === 'done') return 'ok';
  if (state.status === 'idle') return 'todo';
  if (index < state.step) return 'ok';
  return index === state.step ? 'on' : 'todo';
}

function liveText(state: StageState): string {
  if (state.status === 'idle') return t('try.live.ready');
  if (state.status === 'done') return t('try.live.done');
  if (state.step === 2) return t('try.live.hammer');
  if (state.step === 3) return t('try.live.receipt');
  return t('try.live.open');
}

/** Four steps, lit as the run reaches them. Colour is never the only signal: each has a mark. */
export function StepTracker({ state }: { state: StageState }) {
  return (
    <ol className="gv-judge__steps" aria-label={t('try.stepsLabel')}>
      {STEPS.map((key, i) => {
        const mark = markFor(state, i);
        return (
          <li
            key={key}
            className="gv-judge__stepitem"
            data-s={mark}
            {...(mark === 'on' ? { 'aria-current': 'step' as const } : {})}
          >
            <b aria-hidden="true">{mark === 'ok' ? CHECK : i + 1}</b>
            <span>{t(key)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function chipText(pad: Pad): string {
  switch (pad.phase) {
    case 'idle':
      return t('try.pad.none');
    case 'placing':
      return t('try.pad.placing');
    case 'held':
    case 'lead':
      return t('try.pad.held', { amount: formatUsdCompact(pad.cents ?? 0) });
    case 'win':
      return t('try.pad.win', { amount: formatUsd(pad.cents ?? 0) });
    case 'released':
      return t('try.pad.released');
  }
}

function PaddleRow({ pad, pop }: { pad: Pad; pop: boolean }) {
  return (
    <li className="gv-judge__pad" data-s={pad.phase} data-pop={pop ? 'on' : 'off'}>
      <span className="gv-judge__padno" aria-hidden="true">
        {pad.no}
      </span>
      <span className="gv-judge__padname">
        {pad.name}
        <small>{t(pad.via)}</small>
      </span>
      <span className="gv-judge__padchip">{chipText(pad)}</span>
    </li>
  );
}

function Slip({ state }: { state: StageState }) {
  const winner = state.pads.find((p) => p.phase === 'win');
  const losers = state.pads.filter((p) => p.phase === 'released');
  return (
    <aside
      className="gv-judge__slip"
      aria-labelledby="gv-judge-slip-h"
      data-printed={state.printed}
    >
      <h3 id="gv-judge-slip-h">
        {t('try.slip.title')} <span>{t('try.slip.sim')}</span>
      </h3>
      <div className="gv-judge__paperwrap">
        {state.printed && winner !== undefined ? (
          <div className="gv-judge__paper">
            <dl>
              <dt>{t('try.slip.lot')}</dt>
              <dd>{t('try.slip.lotValue')}</dd>
              <dt>{t('try.slip.winner')}</dt>
              <dd>{t('try.slip.winnerValue', { no: winner.no })}</dd>
            </dl>
            <dl>
              {losers.map((pad) => (
                <div key={pad.no} className="gv-judge__held">
                  <dt>{t('try.slip.held', { name: pad.name })}</dt>
                  <dd>{formatUsd(pad.cents ?? 0)}</dd>
                </div>
              ))}
              <dt>{t('try.slip.released')}</dt>
              <dd>{t('try.slip.releasedValue', { n: losers.length })}</dd>
            </dl>
            <dl className="gv-judge__total">
              <dt>{t('try.slip.settles')}</dt>
              <dd>{formatUsd(winner.cents ?? 0)}</dd>
              <dt>{t('try.slip.ref')}</dt>
              <dd>{`SIM-${String(LOT_NUMBER).padStart(4, '0')}-DEMO`}</dd>
            </dl>
            <p className="gv-judge__fine">{t('try.slip.disclaimer')}</p>
            <span className="gv-judge__stamp" aria-hidden="true">
              {t('try.stamp')}
            </span>
          </div>
        ) : (
          <p className="gv-judge__empty">{t('try.slip.empty')}</p>
        )}
      </div>
      <p className="gv-judge__fine">{t('try.slip.fine')}</p>
    </aside>
  );
}

/** Fig. 1: the simulated run as an auction stage, tracker on top, receipt slip at the side. */
export function JudgeStage({ state }: { state: StageState }) {
  const price = formatUsdCompact(state.priceCents);
  const leader = state.leader === null ? undefined : state.pads[state.leader];
  const hit = state.hammered && state.status !== 'done';
  return (
    <figure className="gv-judge__fig" data-status={state.status} data-hammer={state.hammered}>
      <figcaption className="gv-judge__figbar">
        <span className="gv-judge__eyebrow">{t('try.fig')}</span>
        <span className="gv-judge__simtag">{t('try.simTag')}</span>
      </figcaption>
      <div className="gv-judge__stage" data-shake={hit ? 'on' : 'off'}>
        <div className="gv-judge__top">
          <span className="gv-judge__live" data-status={state.status}>
            <span className="gv-judge__dot" aria-hidden="true" />
            {liveText(state)}
          </span>
          <span>{t('try.simMeta')}</span>
        </div>
        <StepTracker state={state} />
        <div className="gv-judge__floor">
          <div className="gv-judge__lot">
            <p className="gv-judge__lotname">
              {t('try.lot')}
              <b>{t('try.lotName')}</b>
            </p>
            <div className="gv-judge__price">
              <div className="gv-judge__amt" key={state.bump} aria-hidden="true">
                <sup>{price.slice(0, 1)}</sup>
                {price.slice(1)}
              </div>
              <p className="gv-judge__leadline">
                {leader === undefined ? t('try.lead.opening') : t('try.lead.leading')}
                <b>
                  {leader === undefined
                    ? t('try.lead.none')
                    : t('try.lead.paddle', { no: leader.no, name: leader.name })}
                </b>
              </p>
            </div>
            <div className="gv-judge__clock" aria-hidden="true">
              <i data-run={state.clockRunning} data-over={state.hammered} />
            </div>
            <p className="gv-judge__say" role="status" aria-live="polite">
              {state.narration}
            </p>
          </div>
          <ul className="gv-judge__pads" aria-label={t('try.padsLabel')}>
            {state.pads.map((pad) => (
              <PaddleRow key={pad.no} pad={pad} pop={pad.phase === 'placing'} />
            ))}
          </ul>
          <Slip state={state} />
        </div>
        <div className="gv-judge__hammer" data-hit={hit} aria-hidden="true">
          {t('try.stamp')}
        </div>
      </div>
    </figure>
  );
}
