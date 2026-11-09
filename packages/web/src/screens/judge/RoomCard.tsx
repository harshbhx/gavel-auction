import { useState } from 'react';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import type { LiveRoom } from './liveRoom';
import { ChunkBoundary, lazyWithRetry } from '../states/ChunkBoundary';

const QrCode = lazyWithRetry(() => import('../join/QrCode'));

/** Shown with the sample label when the visitor has no live room. It is not a real room code. */
export const SAMPLE_CODE = 'K7M2QX';

const SAMPLE_CELLS = 25;

/** A fixed pattern with finder squares: plainly a picture of a QR code, and it scans to nothing. */
function samplePattern(): string {
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const inFinder = (x: number, y: number): boolean =>
    (x < 7 && y < 7) || (x >= SAMPLE_CELLS - 7 && y < 7) || (x < 7 && y >= SAMPLE_CELLS - 7);
  const finderOn = (x: number, y: number): boolean => {
    const ox = x >= SAMPLE_CELLS - 7 ? x - (SAMPLE_CELLS - 7) : x;
    const oy = y >= SAMPLE_CELLS - 7 ? y - (SAMPLE_CELLS - 7) : y;
    const d = Math.max(Math.abs(ox - 3), Math.abs(oy - 3));
    return d === 3 || d <= 1;
  };
  const parts: string[] = [];
  for (let y = 0; y < SAMPLE_CELLS; y += 1) {
    for (let x = 0; x < SAMPLE_CELLS; x += 1) {
      const on = inFinder(x, y) ? finderOn(x, y) : rand() > 0.52;
      if (on) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join('');
}

const SAMPLE_PATH = samplePattern();

export interface RoomCardProps {
  readonly room: LiveRoom | null;
  /** Writes text to the clipboard. Rejects when the browser refuses. */
  readonly writeClipboard?: (text: string) => Promise<void>;
  readonly origin?: string;
  readonly id?: string;
}

/** The room code and QR. Real only when this tab holds a live room, otherwise a labelled sample. */
export function RoomCard({
  room,
  writeClipboard = (text) => navigator.clipboard.writeText(text),
  origin = window.location.origin,
  id = 'gv-judge-room',
}: RoomCardProps) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const live = room !== null && room.code !== null;
  const code = live ? room.code : SAMPLE_CODE;
  const copy = (): void => {
    if (code === null) return;
    writeClipboard(code).then(
      () => setCopied('done'),
      () => setCopied('failed'),
    );
  };
  return (
    <div className="gv-judge__room" data-live={live}>
      <div className="gv-judge__qr">
        {live ? (
          <div role="group" aria-label={t('try.room.qrLive')}>
            <ChunkBoundary>
              <QrCode url={`${origin}${room.join}`} size={128} />
            </ChunkBoundary>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${SAMPLE_CELLS} ${SAMPLE_CELLS}`}
            role="img"
            aria-label={t('try.room.qrSample')}
            shapeRendering="crispEdges"
          >
            <path d={SAMPLE_PATH} fill="currentColor" />
          </svg>
        )}
      </div>
      <div className="gv-judge__roomtext">
        <p className="gv-judge__eyebrow" id={`${id}-label`}>
          {t('try.room.code')}
          <span className="gv-judge__badge" data-live={live}>
            {live ? t('try.room.live') : t('try.room.sample')}
          </span>
        </p>
        <p className="gv-judge__code" aria-labelledby={`${id}-label`}>
          {code}
        </p>
        <Button variant="outline" onClick={copy} aria-describedby={`${id}-note`}>
          {copied === 'done' ? t('generic.copied') : t('try.room.copy')}
        </Button>
      </div>
      <p className="gv-judge__note" id={`${id}-note`} role="status">
        {live ? t('try.room.liveNote') : t('try.room.sampleNote')}
      </p>
    </div>
  );
}
