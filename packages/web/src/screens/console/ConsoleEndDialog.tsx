import { useEffect, useId, useRef } from 'react';

import { keepFocusOnOverlay, useEscapeKey, useFocusTrap } from '../../a11y/useFocus';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { formatUsd } from '../../util/money';
import './consoleEnd.css';

/** Where Join room goes: the start page with the join code field ready. */
export const JOIN_ROOM_HREF = '/?join=1';
/** Where Go home goes: the start page. */
export const HOME_HREF = '/';

/** How the lot ended, with what the pop-up needs to say it. */
export type ConsoleEnd =
  | { readonly kind: 'sold'; readonly paddle: number; readonly priceCents: number }
  | { readonly kind: 'noSale' }
  | { readonly kind: 'stopped' };

export interface ConsoleEndDialogProps {
  readonly open: boolean;
  readonly end: ConsoleEnd;
  /** Closes the pop-up and stays on the console. Escape and the backdrop do the same. */
  readonly onClose: () => void;
}

function titleOf(end: ConsoleEnd): string {
  if (end.kind === 'sold') return t('console.end.title.sold');
  if (end.kind === 'stopped') return t('console.end.title.stopped');
  return t('console.end.title.noSale');
}

function bodyOf(end: ConsoleEnd): string {
  if (end.kind === 'sold') {
    return t('console.end.body.sold', { n: end.paddle, amount: formatUsd(end.priceCents) });
  }
  if (end.kind === 'stopped') return t('console.end.body.stopped');
  return t('console.end.body.noSale');
}

/**
 * The alert the auctioneer gets when the lot closes, is won or is stopped. It says how the lot
 * ended and offers two ways on: join another room, or go home. Focus stays inside it while it is
 * open. Escape only closes it and leaves the console as it was, so the result line, the ladder
 * and the audit link behind it stay in reach.
 */
export function ConsoleEndDialog({ open, end, onClose }: ConsoleEndDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useFocusTrap(panelRef, { active: open });
  useEscapeKey(onClose, open);
  // Focus starts on the panel, not on a link: a key still held from the hammer hold must not
  // follow a link or close the pop-up before it has been read.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="gv-dialog-backdrop"
      role="presentation"
      onClick={onClose}
      onMouseDown={keepFocusOnOverlay}
    >
      <div
        ref={panelRef}
        className="gv-dialog gv-console-end"
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-end={end.kind}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="gv-console-end__title">
          {titleOf(end)}
        </h2>
        <div id={bodyId} className="gv-console-end__body">
          <p>{bodyOf(end)}</p>
          <p>{t('console.end.next')}</p>
        </div>
        <div className="gv-console-end__actions">
          <a
            className="gv-btn gv-btn--bid gv-btn--solid"
            data-size="bid"
            data-tone="accent"
            href={JOIN_ROOM_HREF}
          >
            {t('console.end.join')}
          </a>
          <a
            className="gv-btn gv-btn--bid gv-btn--outline"
            data-size="bid"
            data-tone="neutral"
            href={HOME_HREF}
          >
            {t('console.end.home')}
          </a>
        </div>
        <Button variant="text" tone="neutral" onClick={onClose}>
          {t('console.end.stay')}
        </Button>
      </div>
    </div>
  );
}
