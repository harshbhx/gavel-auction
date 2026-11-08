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
  // An outbid waits for a real price, so the announcement never carries the $0.00 default.
  const waitingForPrice = useRef(false);
  const latestCents = useRef(currentCents);
  latestCents.current = currentCents;
  const optIn = useRef(vibrate);
  optIn.current = vibrate;

  useEffect(() => {
    if (previous.current !== 'outbid' && status === 'outbid') {
      waitingForPrice.current = true;
      if (optIn.current) vibrateOnce();
    }
    if (status !== 'outbid') waitingForPrice.current = false;
    previous.current = status;
    if (!waitingForPrice.current || currentCents <= 0) return undefined;
    // One tick later, so a price frame that lands right behind the status change is the one read.
    const timer = setTimeout(() => {
      if (!waitingForPrice.current || latestCents.current <= 0) return;
      waitingForPrice.current = false;
      announce(
        'polite',
        t('bid.announce.outbid', { amount: formatUsd(latestCents.current) }),
        'outbid',
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [status, currentCents]);

  const setVibrate = useCallback((on: boolean): void => {
    setVibrateState(on);
    writeOptIn(on);
  }, []);

  return { vibrate, setVibrate };
}
