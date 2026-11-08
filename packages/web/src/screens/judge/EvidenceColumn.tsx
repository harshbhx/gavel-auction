import { t } from '../../copy/t';
import { DOCS_URL } from '../landing/LandingSections';
import { RoomCard } from './RoomCard';
import type { LiveRoom } from './liveRoom';

export const TRUST_DOC_URL = `${DOCS_URL}/docs/judges/trust-and-faq`;
export const BUYERS_DOC_URL = `${DOCS_URL}/docs/judges/sandbox-buyers`;

const MINUS = String.fromCharCode(0x2212);

const PROVEN = [
  ['try.ev.p1', 'try.ev.p1d'],
  ['try.ev.p2', 'try.ev.p2d'],
  ['try.ev.p3', 'try.ev.p3d'],
  ['try.ev.p4', 'try.ev.p4d'],
  ['try.ev.p5', 'try.ev.p5d'],
] as const;

const NOT_CLAIMED = [
  ['try.ev.n1', 'try.ev.n1d'],
  ['try.ev.n2', 'try.ev.n2d'],
  ['try.ev.n3', 'try.ev.n3d'],
  ['try.ev.n4', 'try.ev.n4d'],
  ['try.ev.n5', 'try.ev.n5d'],
] as const;

type Pair = readonly [
  (typeof PROVEN)[number][0] | (typeof NOT_CLAIMED)[number][0],
  (typeof PROVEN)[number][1] | (typeof NOT_CLAIMED)[number][1],
];

function Facts({
  title,
  id,
  items,
  mark,
}: {
  title: string;
  id: string;
  items: readonly Pair[];
  mark: 'yes' | 'no';
}) {
  return (
    <section className="gv-judge__facts" data-kind={mark} aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <ul>
        {items.map(([head, detail]) => (
          <li key={head}>
            <span className="gv-judge__mark" aria-hidden="true">
              {mark === 'yes' ? '+' : MINUS}
            </span>
            <span>
              {t(head)}
              <small>{t(detail)}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Proven and Not claimed, as plain lists. Used in the sidebar and in the dialog. */
export function ProvenLists({ idPrefix = 'gv-judge' }: { idPrefix?: string }) {
  return (
    <div className="gv-judge__proof">
      <Facts title={t('try.ev.proven')} id={`${idPrefix}-proven`} items={PROVEN} mark="yes" />
      <Facts
        title={t('try.ev.notClaimed')}
        id={`${idPrefix}-notclaimed`}
        items={NOT_CLAIMED}
        mark="no"
      />
    </div>
  );
}

/** The right-hand trust column: evidence, the room code, and the one rule as a pull quote. */
export function EvidenceColumn({ room }: { room: LiveRoom | null }) {
  return (
    <aside className="gv-judge__side" aria-label={t('try.ev.title')}>
      <section aria-labelledby="gv-judge-ev">
        <h2 id="gv-judge-ev" className="gv-judge__rule">
          {t('try.ev.title')}
        </h2>
        <ProvenLists />
        <p className="gv-judge__docs">
          <a className="ui-link" href={TRUST_DOC_URL}>
            {t('try.ev.trust')}
          </a>
          <a className="ui-link" href={BUYERS_DOC_URL}>
            {t('try.ev.buyers')}
          </a>
        </p>
      </section>
      <section aria-labelledby="gv-judge-rm">
        <h2 id="gv-judge-rm" className="gv-judge__rule">
          {t('try.room.title')}
        </h2>
        <RoomCard room={room} id="gv-judge-room-side" />
      </section>
      <blockquote className="gv-judge__quote">
        <p>{t('try.quote')}</p>
        <cite>{t('try.quoteCite')}</cite>
      </blockquote>
    </aside>
  );
}
