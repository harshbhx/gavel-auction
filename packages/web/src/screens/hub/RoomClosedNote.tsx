import { useState } from 'react';
import { t } from '../../copy/t';
import { takeRoomClosedNote } from './closeRoom';
import './roomClosedNote.css';

/** A small status line on the landing page after a judge closed their room from the hub. */
export function RoomClosedNote() {
  const [shown] = useState(takeRoomClosedNote);
  if (!shown) return null;
  return (
    <p className="gv-hub__closednote" role="status" data-testid="room-closed-note">
      {t('hub.close.noted')}
    </p>
  );
}
