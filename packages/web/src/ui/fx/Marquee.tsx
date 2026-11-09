import { useState } from 'react';
import { useReducedMotion } from './hooks';

/**
 * Endless row of plain text chips, in the style of the Magic UI Marquee. Original code, CSS only.
 * A visible button stops the movement (WCAG 2.2.2): the chips then wrap onto rows like under
 * reduced motion. The copy of the row is hidden from assistive tech and from the tab order. Under reduced motion
 * there is no copy and no movement: the chips wrap onto several lines.
 */
export function Marquee({
  items,
  label,
  pauseLabel,
  playLabel,
}: {
  items: readonly string[];
  label: string;
  /** Name of the stop button. Without both names there is no button. */
  pauseLabel?: string;
  playLabel?: string;
}) {
  const systemReduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const reduced = systemReduced || paused;
  const control = !systemReduced && pauseLabel !== undefined && playLabel !== undefined;
  const row = (hidden: boolean) => (
    <ul className="fx-marquee__row" aria-hidden={hidden ? true : undefined}>
      {items.map((item) => (
        <li key={item} className="fx-marquee__chip">
          {item}
        </li>
      ))}
    </ul>
  );
  return (
    <>
      {control && (
        <button
          type="button"
          className="fx-marquee__toggle"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? playLabel : pauseLabel}
        </button>
      )}
      <div
        className="fx-marquee"
        role="group"
        aria-label={label}
        data-motion={reduced ? 'off' : 'on'}
      >
        <div className="fx-marquee__track">
          {row(false)}
          {!reduced && row(true)}
        </div>
      </div>
    </>
  );
}
