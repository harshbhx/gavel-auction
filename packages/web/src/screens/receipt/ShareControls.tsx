import { useRef, useState } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import './share.css';
import { ChunkBoundary, lazyWithRetry } from '../states/ChunkBoundary';

const QrCode = lazyWithRetry(() => import('../join/QrCode'));

/** A minted receipt link and when it stops working (epoch ms), or null when it could not be made. */
export type ReceiptLink = { link: string; expiresAt: number };
export type MintReceiptLink = () => Promise<ReceiptLink | null>;

type Copy = 'idle' | 'copied' | 'selected';

/**
 * Copy text with the clipboard API. False when the browser has none or refuses it (an insecure
 * page, a denied permission), so the caller can fall back to selecting the text.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Share the receipt: make a link on demand, show it with a QR code, copy it. The copy button falls
 * back to selecting the link text when the clipboard is not available. Nothing is downloaded.
 */
export function ShareControls({ mint }: { mint: MintReceiptLink }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [made, setMade] = useState<ReceiptLink | null>(null);
  const [copy, setCopy] = useState<Copy>('idle');
  const field = useRef<HTMLInputElement>(null);

  const create = (): void => {
    setState('busy');
    mint()
      .then((result) => {
        setMade(result);
        setState(result === null ? 'failed' : 'idle');
      })
      .catch(() => setState('failed'));
  };

  const copyLink = (): void => {
    if (made === null) return;
    void copyToClipboard(made.link).then((ok) => {
      if (ok) {
        setCopy('copied');
        return;
      }
      const el = field.current;
      if (el !== null) {
        el.focus();
        el.select();
        el.setSelectionRange(0, made.link.length);
      }
      setCopy('selected');
    });
  };

  return (
    <section className="gv-share" aria-labelledby="gv-share-title">
      <h3 id="gv-share-title">{t('receipt.share.title')}</h3>
      {made === null ? (
        <Button variant="outline" onClick={create} disabled={state === 'busy'}>
          {state === 'busy' ? t('receipt.share.creating') : t('receipt.share.create')}
        </Button>
      ) : (
        <div className="gv-share__link">
          <label htmlFor="gv-share-field">{t('receipt.share.field')}</label>
          <input
            id="gv-share-field"
            ref={field}
            className="gv-share__field"
            type="text"
            readOnly
            value={made.link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="gv-share__row">
            <Button variant="outline" onClick={copyLink}>
              {t('receipt.share.copy')}
            </Button>
          </div>
          <div className="gv-share__qr">
            <ChunkBoundary>
              <QrCode url={made.link} size={192} />
            </ChunkBoundary>
          </div>
          <p className="gv-share__note">
            {t('receipt.share.note', { until: new Date(made.expiresAt).toLocaleString() })}
          </p>
        </div>
      )}
      <p role="status" className="gv-share__status">
        {state === 'failed' && t('receipt.share.failed')}
        {copy === 'copied' && t('receipt.share.copied')}
        {copy === 'selected' && t('receipt.share.selected')}
      </p>
    </section>
  );
}
