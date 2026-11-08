import { useReducedMotion } from './hooks';

/**
 * Endless row of plain text chips, in the style of the Magic UI Marquee. Original code, CSS only.
 * The copy of the row is hidden from assistive tech and from the tab order. Under reduced motion
 * there is no copy and no movement: the chips wrap onto several lines.
 */
export function Marquee({ items, label }: { items: readonly string[]; label: string }) {
  const reduced = useReducedMotion();
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
  );
}
