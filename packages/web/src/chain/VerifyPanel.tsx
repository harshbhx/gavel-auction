import { useId, useState } from 'react';
import { t } from '../copy/t';
import { Button } from '../design/primitives/Button';
import { fetchRoomLedger, type LedgerFetch } from '../net/judgeRooms';
import { ChainBadge } from './ChainCheck';
import { verifyLedger, type ChainVerdict } from './verifyLedger';
import './chain.css';

/** The judge's own room, as far as the verify area needs it. */
export interface VerifyRoom {
  readonly roomId: string;
  /** The read-only reviewer token of the room. */
  readonly reviewer: string | null;
  /** The read-only audit trail link, with its token in the fragment. */
  readonly audit?: string | null;
}

export interface VerifyPanelProps {
  /** The room this tab started, when there is one. */
  readonly room?: VerifyRoom | null;
  /** The API base for the room's ledger. Without it only pasted or picked exports are checked. */
  readonly apiBase?: string | undefined;
  /** Reads the room's ledger. Defaults to the real route; tests pass their own. */
  readonly loadLedger?: (apiBase: string, roomId: string, token: string) => Promise<LedgerFetch>;
  /** Heading level: the dialog and the page differ. */
  readonly headingId?: string;
}

/** A recording or export may carry the bundle under `ledger`; a bare bundle is used as it is. */
export function unwrapLedger(raw: unknown): unknown {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const inner = (raw as Record<string, unknown>)['ledger'];
    if (typeof inner === 'object' && inner !== null && !('events' in raw)) return inner;
  }
  return raw;
}

/** Parses pasted text into a verdict. Text that is not JSON is `invalid`; empty text is `none`. */
export function verdictForText(text: string): ChainVerdict {
  if (text.trim() === '') return { kind: 'none' };
  try {
    return verifyLedger(unwrapLedger(JSON.parse(text) as unknown));
  } catch {
    return { kind: 'invalid' };
  }
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsText(file);
  });
}

type RoomState = 'idle' | 'loading' | 'notYet' | 'denied' | 'failed';

/**
 * Verify area for judges: paste or pick a ledger export, or load the ledger of the room this tab
 * started through its read-only reviewer link, and see the hash-chain check run in the browser.
 */
export function VerifyPanel({
  room = null,
  apiBase,
  loadLedger = fetchRoomLedger,
  headingId = 'gv-verify-title',
}: VerifyPanelProps) {
  const areaId = useId();
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<ChainVerdict | null>(null);
  const [roomState, setRoomState] = useState<RoomState>('idle');
  const [fileFailed, setFileFailed] = useState(false);

  const canLoad = room !== null && room.reviewer !== null && apiBase !== undefined;

  const check = (): void => {
    setRoomState('idle');
    setVerdict(verdictForText(text));
  };

  const onFile = (file: File | undefined): void => {
    if (file === undefined) return;
    setFileFailed(false);
    readText(file).then(
      (body) => {
        setText(body);
        setRoomState('idle');
        setVerdict(verdictForText(body));
      },
      () => setFileFailed(true),
    );
  };

  const loadRoom = (): void => {
    if (room === null || room.reviewer === null || apiBase === undefined) return;
    setRoomState('loading');
    setVerdict(null);
    void loadLedger(apiBase, room.roomId, room.reviewer).then((result) => {
      if (result.kind === 'ok') {
        setRoomState('idle');
        setVerdict(verifyLedger(unwrapLedger(result.ledger)));
      } else {
        setRoomState(result.kind);
      }
    });
  };

  const roomMessage =
    roomState === 'loading'
      ? t('verify.room.loading')
      : roomState === 'notYet'
        ? t('verify.room.notYet')
        : roomState === 'denied'
          ? t('verify.room.denied')
          : roomState === 'failed'
            ? t('verify.room.failed')
            : null;

  return (
    <section className="gv-verify" aria-labelledby={headingId} data-testid="verify-panel">
      <h2 id={headingId}>{t('verify.title')}</h2>
      <p>{t('verify.lead')}</p>

      <div className="gv-verify__room">
        <Button variant="outline" disabled={!canLoad || roomState === 'loading'} onClick={loadRoom}>
          {t('verify.room.button')}
        </Button>
        <p className="gv-verify__hint">{canLoad ? t('verify.room.hint') : t('verify.room.none')}</p>
        {roomMessage !== null && (
          <p
            className="gv-verify__msg"
            role={roomState === 'loading' ? 'status' : 'alert'}
            data-state={roomState}
          >
            {roomMessage}
          </p>
        )}
        {room?.audit !== undefined && room.audit !== null && (
          <p>
            <a className="ui-link" href={room.audit}>
              {t('verify.audit')}
            </a>
          </p>
        )}
      </div>

      <div className="gv-verify__paste">
        <label htmlFor={`${areaId}-text`}>{t('verify.paste.label')}</label>
        <textarea
          id={`${areaId}-text`}
          className="gv-input gv-verify__text"
          rows={6}
          spellCheck={false}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={`${areaId}-hint`}
        />
        <small id={`${areaId}-hint`}>{t('verify.paste.hint')}</small>
        <div className="gv-verify__actions">
          <Button onClick={check} disabled={text.trim() === ''}>
            {t('verify.check')}
          </Button>
          <label className="gv-verify__file">
            <span>{t('verify.file')}</span>
            <input
              type="file"
              accept="application/json,.json,text/plain"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
        </div>
        {fileFailed && (
          <p className="gv-verify__msg" role="alert">
            {t('verify.file.failed')}
          </p>
        )}
      </div>

      {verdict !== null && <ChainBadge verdict={verdict} />}
    </section>
  );
}
