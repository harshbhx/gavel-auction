import { useCallback, useEffect, useRef, useState } from 'react';

import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';

export const VIBRATE_KEY = 'gavel.vibrateOutbid';
export const VIBRATE_MS = 60;

function readOptIn(): boolean {
  try {
    return globalThis.sessionStorage.getItem(VIBRATE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOptIn(on: boolean): void {
  try {
    globalThis.sessionStorage.setItem(VIBRATE_KEY, on ? '1' : '0');
  } catch {
    // Storage can be blocked; the choice then lasts for this screen only.
  }
}

/** Vibrates for 60 ms when the device supports it. Returns whether it was called. */
export function vibrateOnce(): boolean {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav === undefined || typeof nav.vibrate !== 'function') return false;
  nav.vibrate(VIBRATE_MS);
  return true;
}

export interface UseOutbid {
  vibrate: boolean;
  setVibrate: (on: boolean) => void;
}

/**
 * Announces an outbid through the polite live region and, only when the bidder opted in
 * (default off, kept for the session), vibrates once (R-WEB-060).
 */
export function useOutbid(status: string, currentCents: number): UseOutbid {
  const [vibrate, setVibrateState] = useState<boolean>(readOptIn);
  const previous = useRef(status);
  const optIn = useRef(vibrate);
  optIn.current = vibrate;

  useEffect(() => {
    if (previous.current !== 'outbid' && status === 'outbid') {
      announce('polite', t('bid.announce.outbid', { amount: formatUsd(currentCents) }), 'outbid');
      if (optIn.current) vibrateOnce();
    }
    previous.current = status;
  }, [status, currentCents]);

  const setVibrate = useCallback((on: boolean): void => {
    setVibrateState(on);
    writeOptIn(on);
  }, []);

  return { vibrate, setVibrate };
}
