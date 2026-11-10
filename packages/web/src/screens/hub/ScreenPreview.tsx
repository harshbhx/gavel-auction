import { useEffect, useRef, useState } from 'react';
import { t } from '../../copy/t';
import { startLiveRoom } from '../../net/liveRoom';
import { RoomStore } from '../../store/roomStore';
import { ScreenView } from '../screen/ScreenView';

/** The projection screen is laid out for this many CSS pixels and scaled to fit the tile. */
const DESIGN_WIDTH = 1920;
/** A narrow tile (a phone, a half-width column) lays the screen out smaller so its text stays readable. */
const SMALL_DESIGN_WIDTH = 960;
const SMALL_TILE_BELOW = 700;

export interface ScreenPreviewProps {
  readonly roomId: string;
  /** Screen token from the hub link; without it the tile shows the room before the lot opens. */
  readonly token: string | null;
  /** Server base; without it nothing is fetched and no socket is opened. */
  readonly apiBase: string | undefined;
  readonly lotTitle: string;
  readonly code: string | null;
  readonly joinUrl: string;
  /** The hub's own room store, already fed by its live socket. Without it the tile opens its own. */
  readonly store?: RoomStore | undefined;
}

/**
 * A small, silent, live copy of the projection screen: the real ScreenView on its own room store,
 * fed by a screen-role socket when the hub has the screen token, scaled down to the tile.
 */
export function ScreenPreview({
  roomId,
  token,
  apiBase,
  lotTitle,
  code,
  joinUrl,
  store: sharedStore,
}: ScreenPreviewProps) {
  const [ownStore] = useState(() => new RoomStore(roomId));
  const store = sharedStore ?? ownStore;
  const frame = useRef<HTMLDivElement>(null);
  const [design, setDesign] = useState(DESIGN_WIDTH);
  const [scale, setScale] = useState(0.3);
  const designHeight = (design * 9) / 16;

  useEffect(() => {
    const el = frame.current;
    if (el === null) return undefined;
    el.setAttribute('inert', '');
    const measure = (): void => {
      const width = el.getBoundingClientRect().width;
      if (width <= 0) return;
      const next = width < SMALL_TILE_BELOW ? SMALL_DESIGN_WIDTH : DESIGN_WIDTH;
      setDesign(next);
      setScale(width / next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (sharedStore !== undefined || token === null || apiBase === undefined) return undefined;
    const started = startLiveRoom({
      wsBase: apiBase.replace(/^http/, 'ws'),
      roomId,
      token,
      store,
    });
    return () => started?.stop();
  }, [apiBase, roomId, token, store, sharedStore]);

  return (
    <div className="gv-hub__preview" role="group" aria-label={t('hub.previewLabel')}>
      <span className="gv-hub__live">
        <i aria-hidden="true" />
        {t('hub.live')}
      </span>
      <div
        ref={frame}
        className="gv-hub__preview-frame"
        style={{ height: `${designHeight * scale}px` }}
        aria-hidden="true"
      >
        <div
          className="gv-hub__preview-stage"
          style={{
            width: `${design}px`,
            height: `${designHeight}px`,
            transform: `scale(${scale})`,
          }}
        >
          <ScreenView
            lotTitle={lotTitle}
            code={code}
            joinUrl={joinUrl}
            store={store}
            theme="newsprint"
            preview
          />
        </div>
      </div>
    </div>
  );
}
