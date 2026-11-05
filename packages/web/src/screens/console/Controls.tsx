import { useId, useState } from 'react';
import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import type { CopyKey } from '../../copy/en';
import { Button } from '../../design/primitives/Button';
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

/** The reason a control is unavailable, or null when it can be used. */
export function disabledReason(name: ControlName, s: ControlState): ReasonKey | null {
  if (s.stopped) return 'controls.reason.stopped';
  if (!s.online) return 'controls.reason.offline';
  if (s.busy) return 'controls.reason.busy';
  if (s.status !== REQUIRED_STATUS[name]) return WRONG_STATE_REASON[name];
  return null;
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
}: ControlsProps) {
  const [busy, setBusy] = useState(false);
  const [hammerOpen, setHammerOpen] = useState(false);
  const [result, setResult] = useState('');
  const baseId = useId();
  const state: ControlState = { status, online, stopped, busy };

  const run = async (label: string, call: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await call();
      setResult(t('controls.sent', { action: label }));
    } catch {
      const failed = t('controls.failed', { action: label });
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
    { name: 'hammer', label: t('console.hammer'), act: () => setHammerOpen(true) },
  ];

  return (
    <div className="gv-console-controls">
      {items.map((item) => {
        const reason = disabledReason(item.name, state);
        const reasonId = `${baseId}-${item.name}`;
        return (
          <div key={item.name}>
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
      <p role="status">{result}</p>
      <HammerDialog
        open={hammerOpen}
        leader={leader}
        priceCents={priceCents}
        onCancel={() => setHammerOpen(false)}
        onConfirm={() => {
          setHammerOpen(false);
          void run(t('console.hammer'), () => port.hammer(lotId));
        }}
      />
    </div>
  );
}
