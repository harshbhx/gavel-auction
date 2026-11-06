import { t } from '../copy/t';
import { Icon } from './icons';

/** True when this build talks to the in-process fake PayPal (VITE_PAYMENTS=fake). */
export function isFakePayments(): boolean {
  return import.meta.env.VITE_PAYMENTS === 'fake';
}

/**
 * Provenance label for fake payments. The web has no per-room payment mode, so it follows the
 * build setting the sandbox banner shares. Renders nothing when the build uses the PayPal sandbox.
 */
export function FakePaymentsLabel() {
  if (!isFakePayments()) return null;
  return (
    <p role="note" data-testid="fake-payments-label">
      <Icon name="lock" /> <strong>{t('banner.fakePayments')}</strong>
    </p>
  );
}
