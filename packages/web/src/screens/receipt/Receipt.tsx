import type { ReactNode } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import type { HoldView, SettlementView } from '../../ladder/ladderModel';
import { Failed } from './Failed';
import { Fallback } from './Fallback';
import { NonWinner } from './NonWinner';
import { Winner, isCaptured } from './Winner';
import './print.css';

export interface ReceiptProps {
  view: SettlementView | null;
  /** This viewer's paddle. */
  paddle: number | null;
  itemName: string;
  /** Server epoch ms of the settle event. Null hides the time: the render time is never shown. */
  at: number | null;
  /** True when this winner is the runner-up promoted after the first winner could not be charged. */
  runnerUp?: boolean;
  contact?: ReactNode;
}

/**
 * The JSON file content, no remote call (R-WEB-099): the lot, the hammer price when this is the
 * original winner's receipt, the settle time and the viewer's own hold. No other bidder appears.
 */
export function receiptJson(
  view: SettlementView,
  paddle: number | null,
  at: number | null,
): string {
  const own = view.holds.find((h) => h.paddle === paddle);
  return JSON.stringify(
    {
      lotId: view.lotId,
      phase: view.phase,
      ...(view.hammerPriceCents === undefined ? {} : { hammerPriceCents: view.hammerPriceCents }),
      ...(at === null ? {} : { at: new Date(at).toISOString() }),
      holds: own === undefined ? [] : [own],
    },
    null,
    2,
  );
}

function saveJson(view: SettlementView, paddle: number | null, at: number | null): void {
  const url = URL.createObjectURL(
    new Blob([receiptJson(view, paddle, at)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `gavel-receipt-${view.lotId.replace(/[^A-Za-z0-9_-]/g, '')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Body({
  view,
  hold,
  props,
}: {
  view: SettlementView;
  hold: HoldView;
  props: ReceiptProps;
}) {
  const isWinner = view.winnerPaddle !== null && hold.paddle === view.winnerPaddle;
  if (view.phase === 'FAILED_NEEDS_REVIEW' || hold.state === 'FAILED_NEEDS_REVIEW') {
    return <Failed uncertain={isWinner} reference={hold.idSuffix} contact={props.contact} />;
  }
  if (!isWinner) return <NonWinner hold={hold} itemName={props.itemName} at={props.at} />;
  // The hammer price belongs to the original winner's receipt only.
  const price = props.runnerUp === true ? null : (view.hammerPriceCents ?? null);
  if (props.runnerUp === true && isCaptured(hold)) {
    return (
      <Fallback
        itemName={props.itemName}
        chargedCents={hold.capturedCents}
        idSuffix={hold.idSuffix}
        at={props.at}
      />
    );
  }
  return <Winner hold={hold} itemName={props.itemName} priceCents={price} at={props.at} />;
}

export function Receipt(props: ReceiptProps) {
  const { view, paddle } = props;
  const hold = view === null ? undefined : view.holds.find((h) => h.paddle === paddle);
  if (view === null || hold === undefined) {
    return <p role="status">{t('receipt.none')}</p>;
  }
  return (
    <article className="gv-receipt" aria-labelledby="gv-receipt-title">
      <h2 id="gv-receipt-title">{t('receipt.title')}</h2>
      <Body view={view} hold={hold} props={props} />
      <div className="gv-receipt__actions">
        <Button variant="outline" onClick={() => window.print()}>
          {t('receipt.print')}
        </Button>
        <Button variant="outline" onClick={() => saveJson(view, paddle, props.at)}>
          {t('receipt.download')}
        </Button>
      </div>
    </article>
  );
}
