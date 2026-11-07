import { fireEvent, screen } from '@testing-library/react';
import { t } from '../../src/copy/t';

/** Confirms the approval hold the way a person who cannot hold does: two taps on the alternative. */
export function confirmHold(): void {
  fireEvent.click(screen.getByRole('button', { name: t('ui.hold.alt') }));
  fireEvent.click(screen.getByRole('button', { name: t('ui.hold.altArmed') }));
}
