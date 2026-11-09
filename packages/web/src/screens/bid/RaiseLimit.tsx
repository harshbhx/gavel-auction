import { useEffect, useMemo, useState } from 'react';

import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { FakePaymentsLabel } from '../../design/FakePaymentsLabel';
import { Icon } from '../../design/icons';
import { Button } from '../../design/primitives/Button';
import type { PaymentApprovalPort } from '../../payments/port';
import { useApproval } from '../../payments/useApproval';
import { HoldButton } from '../../ui';
import { formatUsdCompact } from '../../util/money';
import '../flows.css';
import { Approve } from '../register/Approve';
import { useLimitEntry } from '../register/LimitEntry';

const CENTS_PER_DOLLAR = 100;

export interface RaiseLimitProps {
  /** The approval port of the room: PayPal, the fake adapter or the judge-room simulation. */
  port: PaymentApprovalPort;
  roomId: string;
  bidderId: string;
  /** The bidder's limit now, in cents. */
  currentCents: number;
  /** The real cap of the room (snapshot `maxCeilingCents`), in cents. */
  maxCents: number;
  presetsCents?: readonly number[];
  allowCustom?: boolean;
  /** Back to the bid screen (after a raise or when the bidder walks away). */
  onClose: () => void;
}

/** The smallest limit that is higher than `currentCents`, in whole dollars. */
export function minRaiseCents(currentCents: number): number {
  return Math.floor(currentCents / CENTS_PER_DOLLAR) * CENTS_PER_DOLLAR + CENTS_PER_DOLLAR;
}

/**
 * Sets a higher limit while bidding. It uses the register screen's own limit control (number box,
 * slider, presets) and the same approval flow; the old hold stays until the new one is held, and
 * the server swaps them (FEAT-61). Held, not charged.
 */
export function RaiseLimit(props: RaiseLimitProps) {
  const { currentCents, maxCents, onClose } = props;
  const [target, setTarget] = useState<number | null>(null);
  const minCents = minRaiseCents(currentCents);
  const presetsCents = useMemo(
    () => (props.presetsCents ?? []).filter((p) => p >= minCents && p <= maxCents),
    [props.presetsCents, minCents, maxCents],
  );

  if (minCents > maxCents) {
    return (
      <main className="gv-flow" data-step="raise" data-state="at-cap">
        <h1 tabIndex={-1}>{t('raise.title')}</h1>
        <p role="status">{t('raise.atCap', { max: formatUsdCompact(maxCents) })}</p>
        <Button onClick={onClose}>{t('raise.cancel')}</Button>
      </main>
    );
  }

  if (target !== null) {
    return (
      <RaiseApproval
        key={target}
        port={props.port}
        roomId={props.roomId}
        bidderId={props.bidderId}
        ceilingCents={target}
        onBack={() => setTarget(null)}
        onClose={onClose}
      />
    );
  }
  return (
    <RaiseEntry
      currentCents={currentCents}
      minCents={minCents}
      maxCents={maxCents}
      presetsCents={presetsCents}
      allowCustom={props.allowCustom ?? true}
      onChoose={setTarget}
      onClose={onClose}
    />
  );
}

function RaiseEntry(props: {
  currentCents: number;
  minCents: number;
  maxCents: number;
  presetsCents: readonly number[];
  allowCustom: boolean;
  onChoose: (cents: number) => void;
  onClose: () => void;
}) {
  const limit = useLimitEntry({
    minCents: props.minCents,
    maxCents: props.maxCents,
    presetsCents: props.presetsCents,
    allowCustom: props.allowCustom,
  });
  const { ceilingCents } = limit;
  const confirm = (): void => {
    limit.touch();
    if (ceilingCents === null) {
      announce('assertive', limit.error ?? limit.rangeText);
      return;
    }
    props.onChoose(ceilingCents);
  };
  return (
    <main className="gv-flow" data-step="raise">
      <h1 tabIndex={-1}>{t('raise.title')}</h1>
      <p className="gv-flow__summary">
        {t('raise.current', { amount: formatUsdCompact(props.currentCents) })}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          limit.touch();
        }}
        noValidate
      >
        {limit.fields}
        {ceilingCents !== null && (
          <section className="gv-flow__held" data-testid="held-block">
            <p>
              <Icon name="lock" />
              <strong>{t('reg.heldNotCharged')}</strong>
            </p>
            <p>{t('reg.heldExplain', { amount: formatUsdCompact(ceilingCents) })}</p>
            <p>{t('raise.keepHold')}</p>
          </section>
        )}
        <FakePaymentsLabel />
        <HoldButton
          key={ceilingCents ?? 'none'}
          label={t('raise.approve')}
          disabled={ceilingCents === null}
          onConfirm={confirm}
        />
      </form>
      <Button variant="outline" onClick={props.onClose}>
        {t('raise.cancel')}
      </Button>
    </main>
  );
}

function RaiseApproval(props: {
  port: PaymentApprovalPort;
  roomId: string;
  bidderId: string;
  ceilingCents: number;
  onBack: () => void;
  onClose: () => void;
}) {
  const { port, roomId, bidderId, ceilingCents } = props;
  const approval = useApproval({ port, roomId, bidderId, scope: `raise:${ceilingCents}` });
  const { start } = approval;
  useEffect(() => {
    // One attempt per mount; the hook de-duplicates a running one.
    void start(ceilingCents);
  }, [start, ceilingCents]);
  return (
    <main className="gv-flow" data-step="raise" data-state="approving">
      <h1 tabIndex={-1}>{t('raise.title')}</h1>
      <Approve
        state={approval.state}
        result={approval.result}
        ceilingCents={ceilingCents}
        onBackToCeiling={props.onBack}
        onRetry={() => void start(ceilingCents)}
        onContinue={props.onClose}
      />
    </main>
  );
}
