import { t } from '../../copy/t';

export interface LotBlockProps {
  /** Public lot title from the room, or null when the room has none. */
  title: string | null;
  /** Short story from the room's lot config, or null to use the catalog text. */
  story?: string | null;
}

/** A simple drawn lot: an engraved plate in a frame. No external image, no hotlink. */
function LotArt() {
  return (
    <svg
      className="bid__lotart"
      viewBox="0 0 160 100"
      role="img"
      aria-label={t('bid.lot.alt')}
      focusable="false"
    >
      <rect x="4" y="4" width="152" height="92" fill="none" stroke="currentColor" strokeWidth="4" />
      <rect
        x="14"
        y="14"
        width="132"
        height="72"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M30 34h70M30 48h90M30 62h54" stroke="currentColor" strokeWidth="3" fill="none" />
      <circle cx="122" cy="66" r="12" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M116 66l4 4 8-9" stroke="currentColor" strokeWidth="3" fill="none" />
    </svg>
  );
}

/** The lot as a plain ruled block: art, name and a short story (no card, no chip). */
export function LotBlock({ title, story = null }: LotBlockProps) {
  const name = title !== null && title.trim() !== '' ? title : t('bid.lot.fallbackName');
  return (
    <div className="bid__lotblock" data-testid="lot-block">
      <LotArt />
      <div className="bid__lottext">
        <h2 className="bid__lotname">{name}</h2>
        <p className="bid__lotstory">
          {story !== null && story.trim() !== '' ? story : t('bid.lot.story')}
        </p>
      </div>
    </div>
  );
}
