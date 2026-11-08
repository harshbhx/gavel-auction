import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import type { IconName } from '../../design/icons/paths';
import type { AuditPayload } from '../../wire';
import type { TrailEntry, TrailKind } from './trail';
import { describeEntry, entryTime, type Names } from './trailText';

const ICON: Record<TrailKind, IconName> = {
  hold: 'lock',
  bid: 'hand',
  outbid: 'current',
  rejected: 'stop',
  expired: 'clock',
  superseded: 'hollow',
  extend: 'clock',
  pause: 'pause',
  stopped: 'stop',
  hammer: 'check',
  settlement: 'lock',
  receipt: 'check',
};

export interface AuditTimelineProps {
  entries: readonly TrailEntry[];
  /** True when the timeline has lines but the filters hide them all. */
  filtered: boolean;
  names: Names;
  onOpen: (row: AuditPayload) => void;
  receiptHref?: string;
}

/** The auction in plain words, oldest first. State is carried by the word and icon, not colour. */
export function AuditTimeline({
  entries,
  filtered,
  names,
  onOpen,
  receiptHref,
}: AuditTimelineProps) {
  return (
    <section className="gv-audit-panel gv-audit-timeline" aria-labelledby="gv-audit-tl-title">
      <header>
        <h2 id="gv-audit-tl-title">{t('audit.tl.title')}</h2>
        <p>{t('audit.tl.lead')}</p>
      </header>
      {entries.length === 0 ? (
        <p className="gv-state gv-state--empty" role="status">
          {filtered ? t('audit.tl.noMatch') : t('audit.tl.empty')}
        </p>
      ) : (
        <ol className="gv-audit-timeline__list" tabIndex={0} aria-label={t('audit.tl.title')}>
          {entries.map((e) => (
            <li key={e.id} data-kind={e.kind}>
              <span className="gv-audit-timeline__mark" aria-hidden="true">
                <Icon name={ICON[e.kind]} size={18} />
              </span>
              <div>
                <p className="gv-audit-timeline__meta">
                  <span className="gv-audit-timeline__kind">{t(`audit.kind.${e.kind}`)}</span>
                  <time
                    className="tabular"
                    {...(e.at === null ? {} : { dateTime: new Date(e.at).toISOString() })}
                  >
                    {entryTime(e)}
                  </time>
                </p>
                <p className="gv-audit-timeline__text">{describeEntry(e, names)}</p>
                {e.row !== undefined && e.kind !== 'outbid' && (
                  <button
                    type="button"
                    className="gv-audit-link"
                    aria-label={`${t('audit.tl.details')}: ${t('audit.drawer.title', { seq: e.row.seq })}`}
                    onClick={() => {
                      if (e.row !== undefined) onOpen(e.row);
                    }}
                  >
                    {t('audit.tl.details')}
                  </button>
                )}
                {e.kind === 'receipt' && receiptHref !== undefined && (
                  <a className="gv-audit-link" href={receiptHref}>
                    {t('audit.tl.receiptLink')}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
