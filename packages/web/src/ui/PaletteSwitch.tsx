import { useState } from 'react';
import { t } from '../copy/t';
import { PALETTES, readStoredPalette, setPalette, type PaletteName } from './palette';

function labelOf(name: PaletteName): string {
  if (name === 'a') return t('ui.palette.a');
  if (name === 'b') return t('ui.palette.b');
  return t('ui.palette.c');
}

/** Three buttons that switch the palette and remember the pick. */
export function PaletteSwitch() {
  const [current, setCurrent] = useState<PaletteName | null>(() => readStoredPalette());
  return (
    <div className="ui-palettes" role="group" aria-label={t('ui.palette.group')}>
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
          {labelOf(name)}
        </button>
      ))}
    </div>
  );
}
