import { useId, useState } from 'react';
import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import type { CopyKey } from '../../copy/en';
import { Button } from '../../design/primitives/Button';
import { HoldButton as DeskHold } from '../../ui';
import { ControlError, ControlTimeoutError } from '../../net/controlPort';
import type { ControlPort } from '../../net/transport';
import type { AuctionStatus } from '../../wire';
import { HammerDialog, type HammerLeader } from './HammerDialog';

export const DEFAULT_EXTEND_MS = 30_000;

export type ControlName = 'open' | 'pause' | 'resume' | 'extend' | 'hammer';

type ReasonKey = Extract<CopyKey, `controls.reason.${string}`>;

const REQUIRED_STATUS: Readonly<Record<ControlName, AuctionStatus>> = {
  open: 'SCHEDULED',
  pause: 'OPEN',
  resume: 'PAUSED',
  extend: 'OPEN',
  hammer: 'OPEN',
};

const WRONG_STATE_REASON: Readonly<Record<ControlName, ReasonKey>> = {
  open: 'controls.reason.notScheduled',
  pause: 'controls.reason.notOpen',
  resume: 'controls.reason.notPaused',
  extend: 'controls.reason.notOpen',
  hammer: 'controls.reason.notOpen',
};

export interface ControlState {
  readonly status: AuctionStatus;
  readonly online: boolean;
  readonly stopped: boolean;
  readonly busy: boolean;
}

/**
 * The status the controls must follow. The server reports a paused lot as OPEN plus a `paused`
 * flag, never as PAUSED, so the console maps the pair to PAUSED. Without this Resume stays
 * disabled while paused and Extend (which the engine refuses while paused) stays enabled.
 */
export function controlStatus(status: AuctionStatus, paused: boolean): AuctionStatus {
  return paused && status === 'OPEN' ? 'PAUSED' : status;
}

/** The reason a control is unavailable, or null when it can be used. */
export function disabledReason(name: ControlName, s: ControlState): ReasonKey | null {
  if (s.stopped) return 'controls.reason.stopped';
  if (!s.online) return 'controls.reason.offline';
  // A slow request never blocks the hammer: the lot clock keeps running meanwhile.
  if (s.busy && name !== 'hammer') return 'controls.reason.busy';
  if (s.status !== REQUIRED_STATUS[name]) return WRONG_STATE_REASON[name];
  return null;
}

/** The words for a refused hammer: a new price, a new leader, or a generic change. */
function hammerConflict(detail: string | null): string {
  if (detail === 'price_changed') return t('controls.hammerPriceChanged');
  if (detail === 'leader_changed') return t('controls.hammerLeaderChanged');
  return t('controls.hammerChanged');
}

export interface ControlsProps {
  readonly port: ControlPort;
  readonly lotId: string;
  readonly status: AuctionStatus;
  readonly online: boolean;
  readonly stopped: boolean;
  /** Extra time per extend, in milliseconds. */
  readonly extendMs?: number;
  readonly leader: HammerLeader | null;
  readonly priceCents: number;
  /** Highest message seq the console has applied. Sent with the hammer so a late bid is refused. */
  readonly seq?: number;
}

export function Controls({
  port,
  lotId,
  status,
  online,
  stopped,
  extendMs = DEFAULT_EXTEND_MS,
  leader,
  priceCents,
  seq = 0,
}: ControlsProps) {
  const [busy, setBusy] = useState(false);
  // The leader and price the auctioneer was shown when the dialog opened. A bid that lands
  // meanwhile must not be hammered under the old question.
  const [shown, setShown] = useState<{
    leader: HammerLeader | null;
    priceCents: number;
  } | null>(null);
  const [result, setResult] = useState('');
  // The desk hold stays done after it completes; a new key makes it usable again.
  const [holdRound, setHoldRound] = useState(0);
  const baseId = useId();
  const state: ControlState = { status, online, stopped, busy };
  const hammerReason = disabledReason('hammer', state);

  const run = async (label: string, call: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await call();
      setResult(t('controls.sent', { action: label }));
    } catch (err) {
      const failed =
        err instanceof ControlTimeoutError
          ? t('controls.unknown', { action: label })
          : err instanceof ControlError && err.status === 409 && label === t('console.hammer')
            ? hammerConflict(err.detail)
            : t('controls.failed', { action: label });
      setResult(failed);
      announce('polite', failed, 'bid_rejected');
    } finally {
      setBusy(false);
    }
  };

  const items: ReadonlyArray<{ name: ControlName; label: string; act: () => void }> = [
    {
      name: 'open',
      label: t('console.open'),
      act: () => void run(t('console.open'), () => port.open(lotId)),
    },
    {
      name: 'pause',
      label: t('console.pause'),
      act: () => void run(t('console.pause'), () => port.pause()),
    },
    {
      name: 'resume',
      label: t('console.resume'),
      act: () => void run(t('console.resume'), () => port.resume()),
    },
    {
      name: 'extend',
      label: t('console.extend', { s: Math.round(extendMs / 1000) }),
      act: () =>
        void run(t('console.extend', { s: Math.round(extendMs / 1000) }), () =>
          port.extend(extendMs),
        ),
    },
    { name: 'hammer', label: t('console.hammer'), act: () => setShown({ leader, priceCents }) },
  ];

  /** One path for the dialog and the desk hold: a bid that landed after the question was shown refuses. */
  const hammerNow = (was: { leader: HammerLeader | null; priceCents: number } | null): void => {
    if (was === null) return;
    if (was.priceCents !== priceCents || was.leader?.paddle !== leader?.paddle) {
      const changed = t('controls.hammerChanged');
      setResult(changed);
      announce('polite', changed, 'bid_rejected');
      return;
    }
    void run(t('console.hammer'), () =>
      port.hammer(lotId, {
        priceCents: was.priceCents,
        leaderPaddle: was.leader?.paddle ?? 0,
        seq,
      }),
    );
  };

  return (
    <div className="gv-console-controls">
      {items.map((item) => {
        const reason = disabledReason(item.name, state);
        const reasonId = `${baseId}-${item.name}`;
        return (
          <div key={item.name} className="gv-console-controls__item" data-control={item.name}>
            <Button
              tone={item.name === 'hammer' ? 'danger' : 'accent'}
              disabled={reason !== null}
              aria-describedby={reason === null ? undefined : reasonId}
              onClick={item.act}
            >
              {item.label}
            </Button>
            {reason !== null && <span id={reasonId}>{t(reason)}</span>}
          </div>
        );
      })}
      <div className="gv-console-hammer">
        <DeskHold
          key={holdRound}
          label={t('console.hammerDesk')}
          hint={t('console.hammerDeskHint')}
          disabled={hammerReason !== null}
          confirmAlternative={false}
          onConfirm={() => {
            hammerNow({ leader, priceCents });
            setHoldRound((n) => n + 1);
          }}
        />
        <p className="gv-console-hammer__alt">{t('console.hammerDialogHint')}</p>
      </div>
      <p role="status">{result}</p>
      <HammerDialog
        open={shown !== null}
        leader={shown === null ? leader : shown.leader}
        priceCents={shown === null ? priceCents : shown.priceCents}
        onCancel={() => setShown(null)}
        onConfirm={() => {
          const was = shown;
          setShown(null);
          hammerNow(was);
        }}
      />
    </div>
  );
}
