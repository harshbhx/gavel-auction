import { useEffect, useId, useRef, useState } from 'react';
import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import type { CopyKey } from '../../copy/en';
import { Button } from '../../design/primitives/Button';
import { HoldButton as DeskHold } from '../../ui';
import { ControlError, ControlTimeoutError } from '../../net/controlPort';
import type { ControlPort } from '../../net/transport';
import type { AuctionStatus } from '../../wire';
import { HammerDialog, type HammerLeader } from './HammerDialog';
import { SHORTCUTS, ShortcutHelp, useShortcuts, type ShortcutHandlers } from './ShortcutHelp';

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

/** The slots, in the order they always appear. A slot never moves, it only enables or disables. */
export const CONTROL_ORDER: readonly ControlName[] = [
  'open',
  'pause',
  'resume',
  'extend',
  'hammer',
];

/** The state the lot is in, in words the reason line can use for a wrong-state refusal. */
function wrongState(name: ControlName, status: AuctionStatus): ReasonKey {
  if (status === 'CLOSING' || status === 'SETTLING' || status === 'DONE') {
    return 'controls.reason.ended';
  }
  if (name === 'open') return 'controls.reason.alreadyOpen';
  if (status === 'SCHEDULED') return 'controls.reason.openFirst';
  if (status === 'PAUSED')
    return name === 'resume' ? WRONG_STATE_REASON[name] : 'controls.reason.paused';
  return WRONG_STATE_REASON[name];
}

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
  if (s.status !== REQUIRED_STATUS[name]) return wrongState(name, s.status);
  return null;
}

/**
 * Open lot is a button only before the lot opens. After that its slot holds a short note of the
 * lot state, so the bar never shows a button that can not be used again.
 */
export function showsOpenButton(status: AuctionStatus): boolean {
  return status === 'SCHEDULED';
}

/** The buttons the bar shows in this state, in slot order. */
export function shownControls(status: AuctionStatus): readonly ControlName[] {
  return CONTROL_ORDER.filter((name) => name !== 'open' || showsOpenButton(status));
}

/**
 * The reason that holds for the whole lot, shown when no single control is being pointed at. It
 * comes from the predicate that disables the buttons: a reason is given only when every shown
 * button is off for it, so the line never contradicts a button that can be pressed.
 */
export function lotReason(s: ControlState): ReasonKey | null {
  // The hammer is exempt from busy, so the waiting line follows the other controls.
  if (s.busy && s.online && !s.stopped) return 'controls.reason.busy';
  const reasons = shownControls(s.status).map((name) => disabledReason(name, s));
  const first = reasons[0] ?? null;
  return first !== null && reasons.every((r) => r === first) ? first : null;
}

const NOTE_KEY = {
  open: 'controls.lot.open',
  paused: 'controls.lot.paused',
  closed: 'controls.lot.closed',
} as const;

/** The note that takes the Open lot slot once the lot has opened. */
function lotNote(status: AuctionStatus): string {
  if (status === 'OPEN') return t(NOTE_KEY.open);
  if (status === 'PAUSED') return t(NOTE_KEY.paused);
  return t(NOTE_KEY.closed);
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
  // The slot that was clicked and is waiting on the server; null when nothing is in flight.
  const [pending, setPending] = useState<ControlName | null>(null);
  const busy = pending !== null;
  // The control the pointer or focus is on, so the reason line can explain that one.
  const [aimed, setAimed] = useState<ControlName | null>(null);
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

  const run = async (
    name: ControlName,
    label: string,
    call: () => Promise<void>,
  ): Promise<void> => {
    setPending(name);
    try {
      await call();
      setResult(t('controls.sent', { action: label }));
    } catch (err) {
      const failed =
        err instanceof ControlTimeoutError
          ? t('controls.unknown', { action: label })
          : err instanceof ControlError && err.status === 409 && label === t('console.hammer')
            ? hammerConflict(err.detail)
            : err instanceof ControlError && err.status >= 400 && err.status < 500 && err.detail
              ? t('controls.refused', { action: label, detail: err.detail })
              : t('controls.failed', { action: label });
      setResult(failed);
      announce('polite', failed, 'bid_rejected');
    } finally {
      setPending(null);
    }
  };

  const items: ReadonlyArray<{ name: ControlName; label: string; act: () => void }> = [
    {
      name: 'open',
      label: t('console.open'),
      act: () => void run('open', t('console.open'), () => port.open(lotId)),
    },
    {
      name: 'pause',
      label: t('console.pause'),
      act: () => void run('pause', t('console.pause'), () => port.pause()),
    },
    {
      name: 'resume',
      label: t('console.resume'),
      act: () => void run('resume', t('console.resume'), () => port.resume()),
    },
    {
      name: 'extend',
      label: t('console.extend', { s: Math.round(extendMs / 1000) }),
      act: () =>
        void run('extend', t('console.extend', { s: Math.round(extendMs / 1000) }), () =>
          port.extend(extendMs),
        ),
    },
    { name: 'hammer', label: t('console.hammer'), act: () => setShown({ leader, priceCents }) },
  ];

  // Single keys for the safe controls and `?` for the list. Hammer and stop have no key.
  const [helpOpen, setHelpOpen] = useState(false);
  // A stray key must not change the sale: the first press arms the control and says so, the same
  // key again within three seconds runs it.
  const armedKey = useRef<ControlName | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current !== null) clearTimeout(armTimer.current);
    },
    [],
  );
  const keyFor = (name: ControlName): (() => void) => {
    return () => {
      if (disabledReason(name, state) !== null) return;
      const item = items.find((i) => i.name === name);
      if (item === undefined) return;
      if (armTimer.current !== null) clearTimeout(armTimer.current);
      if (armedKey.current === name) {
        armedKey.current = null;
        item.act();
        return;
      }
      armedKey.current = name;
      const key = SHORTCUTS.find((s) => s.id === name)?.keys ?? '';
      setResult(t('console.shortcut.armed', { key: key.toUpperCase(), action: item.label }));
      armTimer.current = setTimeout(() => {
        armedKey.current = null;
        setResult('');
      }, 3000);
    };
  };
  const shortcuts: ShortcutHandlers = {
    help: () => setHelpOpen(true),
    open: keyFor('open'),
    pause: keyFor('pause'),
    resume: keyFor('resume'),
    extend: keyFor('extend'),
  };
  useShortcuts(shortcuts, shown === null && !helpOpen);

  /** One path for the dialog and the desk hold: a bid that landed after the question was shown refuses. */
  const hammerNow = (was: { leader: HammerLeader | null; priceCents: number } | null): void => {
    if (was === null) return;
    if (was.priceCents !== priceCents || was.leader?.paddle !== leader?.paddle) {
      const changed = t('controls.hammerChanged');
      setResult(changed);
      announce('polite', changed, 'bid_rejected');
      return;
    }
    void run('hammer', t('console.hammer'), () =>
      port.hammer(lotId, {
        priceCents: was.priceCents,
        leaderPaddle: was.leader?.paddle ?? 0,
        seq,
      }),
    );
  };

  // One line under the bar, always the same height: the reason for the control the user is on,
  // else the reason that holds for the lot as a whole. Never one line per button.
  // An enabled control says what it will do; it never borrows a reason from another control.
  const effect: Readonly<Record<ControlName, string>> = {
    open: t('controls.does.open'),
    pause: t('controls.does.pause'),
    resume: t('controls.does.resume'),
    extend: t('controls.does.extend', { s: Math.round(extendMs / 1000) }),
    hammer: t('controls.does.hammer'),
  };
  const wholeLot = lotReason(state);
  const aimedReason = aimed === null ? null : disabledReason(aimed, state);
  const reasonLine =
    aimed === null
      ? wholeLot === null
        ? ''
        : t(wholeLot)
      : aimedReason === null
        ? effect[aimed]
        : t(aimedReason);

  return (
    <div className="gv-console-controls">
      <div className="gv-console-controls__bar" data-testid="control-bar">
        {items.map((item) => {
          const reason = disabledReason(item.name, state);
          const reasonId = `${baseId}-${item.name}`;
          if (item.name === 'open' && !showsOpenButton(status)) {
            return (
              <div key={item.name} className="gv-console-controls__item" data-control={item.name}>
                <span className="gv-console-controls__note" data-slot="lot-note">
                  {lotNote(status)}
                </span>
              </div>
            );
          }
          return (
            <div key={item.name} className="gv-console-controls__item" data-control={item.name}>
              <Button
                tone={item.name === 'hammer' ? 'danger' : 'accent'}
                disabled={reason !== null}
                aria-describedby={reason === null ? undefined : reasonId}
                aria-busy={pending === item.name ? true : undefined}
                onClick={item.act}
                onPointerEnter={() => setAimed(item.name)}
                onPointerLeave={() => setAimed(null)}
                onFocus={() => setAimed(item.name)}
                onBlur={() => setAimed(null)}
              >
                <span className="gv-console-controls__label">{item.label}</span>
                {pending === item.name && (
                  <span className="gv-console-controls__spinner" aria-hidden="true" />
                )}
              </Button>
              {reason !== null && (
                <span id={reasonId} className="gv-sr-only">
                  {t(reason)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="gv-console-controls__reason" data-slot="control-reason">
        {reasonLine}
      </p>
      <p className="gv-console-controls__result" role="status">
        {result}
      </p>
      {status !== 'CLOSING' && status !== 'SETTLING' && status !== 'DONE' && (
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
      )}
      <p className="gv-console-controls__shortcuts">
        <button type="button" className="gv-linkbutton" onClick={() => setHelpOpen(true)}>
          {t('console.shortcutsHint')}
        </button>
      </p>
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
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
