import { useMemo } from 'react';

import { WideAside } from '../WideAside';
import { ChainCheck } from '../../chain/ChainCheck';
import { t } from '../../copy/t';
import { Instructor } from '../../help';
import { receiptSource } from '../../ladder/fromWire';
import { SettlementPanel } from '../../ladder/SettlementPanel';
import type { RoomState } from '../../store/roomReducer';
import { selectors } from '../../store/selectors';
import { Empty, Loading, Offline } from '../states/States';
import { useOnline } from '../states/useOnline';
import { Receipt } from './Receipt';
import type { MintReceiptLink } from './ShareControls';

export interface ReceiptViewProps {
  state: RoomState;
  roomId: string;
  /** Makes a share link. Absent on a shared receipt, which is read-only. */
  share?: MintReceiptLink;
  /** True for a receipt opened from a share link: no audit link, a read-only note. */
  shared?: boolean;
}

/** The receipt page for a room state: the settlement document, its share controls and the ladder. */
export function ReceiptView({ state, roomId, share, shared = false }: ReceiptViewProps) {
  const online = useOnline();
  const stopped = selectors.stopped(state);
  const { view, paddle, at, runnerUp, detail, noHold } = useMemo(
    () => receiptSource(state),
    [state],
  );
  const itemName = state.snapshot?.lotTitle ?? t('receipt.untitled');
  return (
    <main data-route="receipt" {...(shared ? { 'data-shared': 'true' } : {})}>
      {!online && <Offline view="receipt" />}
      <Instructor screen="receipt" roomId={roomId} current={view === null ? null : 0} />
      {stopped && <p role="status">{t('screen.stopped')}</p>}
      {shared && <p>{t('receipt.shared.readOnly')}</p>}
      {state.snapshot === null ? (
        <Loading view="receipt" />
      ) : view === null ? (
        <Empty view="receipt" />
      ) : (
        <div className="gv-receipt-wide">
          <div className="gv-receipt-wide__main">
            <Receipt
              view={view}
              paddle={paddle}
              itemName={itemName}
              at={at}
              runnerUp={runnerUp}
              noHold={noHold}
              {...(share === undefined ? {} : { share })}
            />
            {!shared && (
              <SettlementPanel
                view={view}
                detail={detail}
                auditHref={`/r/${encodeURIComponent(roomId)}/audit`}
              />
            )}
            <ChainCheck allowFile />
          </div>
          <WideAside />
        </div>
      )}
    </main>
  );
}
