import { useRef, type KeyboardEvent } from 'react';
import { t } from '../../copy/t';
import { Dialog } from '../../design/primitives/Dialog';
import { SCRIPTED_DEMO_PATH } from '../../net/scriptedMode';
import { BUYERS_DOC_URL, ProvenLists, TRUST_DOC_URL } from './EvidenceColumn';
import type { LiveRoom } from './liveRoom';
import { RoomCard } from './RoomCard';

export type JudgeTab = 'join' | 'console' | 'screen' | 'receipt' | 'proven';

const TIMES = String.fromCharCode(0xd7);

const TABS: readonly {
  id: JudgeTab;
  label:
    | 'try.tab.join'
    | 'try.tab.console'
    | 'try.tab.screen'
    | 'try.tab.receipt'
    | 'try.tab.proven';
}[] = [
  { id: 'join', label: 'try.tab.join' },
  { id: 'console', label: 'try.tab.console' },
  { id: 'screen', label: 'try.tab.screen' },
  { id: 'receipt', label: 'try.tab.receipt' },
  { id: 'proven', label: 'try.tab.proven' },
];

const VIEWS = {
  console: {
    title: 'try.dlg.consoleTitle',
    what: 'try.dlg.consoleWhat',
    open: 'try.dlg.openConsole',
  },
  screen: { title: 'try.dlg.screenTitle', what: 'try.dlg.screenWhat', open: 'try.dlg.openScreen' },
  receipt: {
    title: 'try.dlg.receiptTitle',
    what: 'try.dlg.receiptWhat',
    open: 'try.dlg.openReceipt',
  },
} as const;

function viewLink(room: LiveRoom | null, view: keyof typeof VIEWS): string | null {
  if (room === null) return null;
  return room[view];
}

function ViewPanel({ view, room }: { view: keyof typeof VIEWS; room: LiveRoom | null }) {
  const copy = VIEWS[view];
  const href = viewLink(room, view);
  return (
    <>
      <h2>{t(copy.title)}</h2>
      <p>{t(copy.what)}</p>
      {href !== null ? (
        <>
          <p className="gv-judge__note">{t('try.dlg.liveNote')}</p>
          <p>
            <a className="gv-judge__linkbtn" href={href}>
              {t(copy.open)}
            </a>
          </p>
        </>
      ) : (
        <>
          <p className="gv-judge__needs">{t('try.dlg.needsRoom')}</p>
          <p className="gv-judge__links">
            <a className="gv-judge__linkbtn" href="/demo">
              {t('try.a1.room')}
            </a>
            <a className="gv-judge__linkbtn gv-judge__linkbtn--alt" href={SCRIPTED_DEMO_PATH}>
              {t('try.a1.script')}
            </a>
          </p>
        </>
      )}
      <p className="gv-judge__links">
        <a className="ui-link" href={TRUST_DOC_URL}>
          {t('try.ev.trust')}
        </a>
        <a className="ui-link" href={BUYERS_DOC_URL}>
          {t('try.ev.buyers')}
        </a>
      </p>
    </>
  );
}

export interface JudgeDialogProps {
  readonly open: boolean;
  readonly tab: JudgeTab;
  readonly onTab: (tab: JudgeTab) => void;
  readonly onClose: () => void;
  readonly room: LiveRoom | null;
}

/** One dialog, five tabs: join, the three room views, and what is proven. */
export function JudgeDialog({ open, tab, onTab, onClose, room }: JudgeDialogProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const jump = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (step === 0 && jump === null) return;
    e.preventDefault();
    const target = TABS[jump ?? (index + step + TABS.length) % TABS.length];
    if (target === undefined) return;
    onTab(target.id);
    refs.current[target.id]?.focus();
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('try.dlg.label')}>
      <div className="gv-judge__dlg">
        <div className="gv-judge__dlgtop">
          <div className="gv-judge__tabs" role="tablist" aria-label={t('try.dlg.label')}>
            {TABS.map((item, i) => (
              <button
                key={item.id}
                ref={(el) => {
                  refs.current[item.id] = el;
                }}
                type="button"
                role="tab"
                id={`gv-judge-tab-${item.id}`}
                aria-controls="gv-judge-panel"
                aria-selected={tab === item.id}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => onTab(item.id)}
                onKeyDown={(e) => move(e, i)}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="gv-judge__x"
            onClick={onClose}
            aria-label={t('generic.close')}
          >
            <span aria-hidden="true">{TIMES}</span>
          </button>
        </div>
        <div
          className="gv-judge__dlgbody"
          role="tabpanel"
          id="gv-judge-panel"
          aria-labelledby={`gv-judge-tab-${tab}`}
        >
          {tab === 'join' && (
            <>
              <h2>{t('try.room.title')}</h2>
              <p>{t('try.dlg.joinLead')}</p>
              <RoomCard room={room} id="gv-judge-room-dlg" />
              {room !== null && (
                <p>
                  <a className="gv-judge__linkbtn gv-judge__linkbtn--alt" href={room.hub}>
                    {t('try.room.hub')}
                  </a>
                </p>
              )}
            </>
          )}
          {tab === 'console' && <ViewPanel view="console" room={room} />}
          {tab === 'screen' && <ViewPanel view="screen" room={room} />}
          {tab === 'receipt' && <ViewPanel view="receipt" room={room} />}
          {tab === 'proven' && (
            <>
              <h2>{t('try.dlg.provenTitle')}</h2>
              <p>{t('try.dlg.provenLead')}</p>
              <ProvenLists idPrefix="gv-judge-dlg" />
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
