import { t } from '../../copy/t';
import { readWinnerDetails } from '../bid/winnerDetails';

export interface WinnerDetailsBlockProps {
  roomId: string;
  paddle: number;
}

/**
 * The winner's own contact details, read from this browser only (never the server). Rendered by
 * the caller for the winning viewer alone; with no saved record it shows nothing.
 */
export function WinnerDetailsBlock({ roomId, paddle }: WinnerDetailsBlockProps) {
  const rec = readWinnerDetails(roomId);
  if (rec === null) return null;
  return (
    <section data-testid="winner-details" aria-label={t('receipt.winnerDetails')}>
      <h2>{t('receipt.winnerDetails')}</h2>
      <dl className="gv-receipt__rows">
        <dt>{t('receipt.winnerPaddle')}</dt>
        <dd>{paddle}</dd>
        {rec.email !== '' && (
          <>
            <dt>{t('receipt.winnerEmail')}</dt>
            <dd>{rec.email}</dd>
          </>
        )}
        {rec.phone !== '' && (
          <>
            <dt>{t('receipt.winnerPhone')}</dt>
            <dd>{rec.phone}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
