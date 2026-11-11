import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';
import type { TrailSummary } from './trail';

/** The result at a glance: lot, winning bid, bidders, bids and holds. */
export function AuditSummary({ summary }: { summary: TrailSummary }) {
  const { priceCents, sold } = summary;
  return (
    <section className="gv-audit-summary" aria-labelledby="gv-audit-summary-title">
      <h2 id="gv-audit-summary-title" className="gv-audit__sr">
        {t('audit.summary')}
      </h2>
      <dl>
        <div data-tile="lot">
          <dt>{t('audit.sum.lot')}</dt>
          <dd>{summary.lotTitle ?? t('audit.sum.untitled')}</dd>
        </div>
        <div data-tile="price" data-sold={sold ? 'true' : 'false'}>
          <dt>{sold ? t('audit.sum.winning') : t('audit.sum.leading')}</dt>
          <dd className="tabular gv-audit-summary__big">
            {priceCents === null || (priceCents === 0 && !sold)
              ? t('audit.sum.noBid')
              : formatUsd(priceCents)}
          </dd>
        </div>
        <div data-tile="status" data-status={summary.status}>
          <dt>{t('audit.sum.status')}</dt>
          <dd>{t(`audit.status.${summary.status}`)}</dd>
        </div>
        <div data-tile="bidders">
          <dt>{t('audit.sum.bidders')}</dt>
          <dd className="tabular gv-audit-summary__big">{summary.bidders}</dd>
        </div>
        <div data-tile="bids">
          <dt>{t('audit.sum.bids')}</dt>
          <dd className="tabular gv-audit-summary__big">{summary.acceptedBids}</dd>
          <dd className="gv-audit-summary__note">
            {t('audit.sum.bidsDetail', {
              accepted: summary.acceptedBids,
              attempts: summary.attempts,
            })}
          </dd>
        </div>
        <div data-tile="holds">
          <dt>{t('audit.sum.holds')}</dt>
          {summary.held + summary.released + summary.charged === 0 ? (
            <dd>{t('audit.sum.holdsNone')}</dd>
          ) : (
            <dd>
              <ul className="gv-audit-summary__holds">
                <li>
                  <span className="tabular">{summary.held}</span> {t('ladder.state.HELD')}
                </li>
                <li>
                  <span className="tabular">{summary.released}</span> {t('ladder.state.SETTLED')}
                </li>
                {summary.charged > 0 && (
                  <li>
                    <span className="tabular">{summary.charged}</span> {t('ladder.state.CAPTURED')}
                  </li>
                )}
              </ul>
            </dd>
          )}
        </div>
      </dl>
    </section>
  );
}
