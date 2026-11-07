import { useState } from 'react';
import {
  PALETTES,
  PALETTE_LABELS,
  readStoredPalette,
  setPalette,
  type PaletteName,
} from './palette';

/** Three buttons that switch the palette and remember the pick. */
export function PaletteSwitch() {
  const [current, setCurrent] = useState<PaletteName | null>(() => readStoredPalette());
  return (
    <div className="ui-palettes" role="group" aria-label="Colour palette">
      {PALETTES.map((name) => (
        <button
          key={name}
          type="button"
          className="ui-palettes__btn"
          aria-pressed={current === name}
          onClick={() => {
            setPalette(name);
            setCurrent(name);
          }}
        >
          {PALETTE_LABELS[name]}
        </button>
      ))}
    </div>
  );
}
