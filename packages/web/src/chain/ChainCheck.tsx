import { useMemo, useState } from 'react';

import { t } from '../copy/t';
import { verifyLedger, type ChainVerdict } from './verifyLedger';
import './chain.css';

export interface ChainCheckProps {
  /** A parsed replay bundle. Absent when the view came without a ledger. */
  ledger?: unknown;
  /** Offer a file picker so a judge can check an exported bundle. */
  allowFile?: boolean;
}

const BROKEN_DETAIL = {
  bad_hash: 'chain.broken.bad_hash',
  bad_prev: 'chain.broken.bad_prev',
  bad_seq: 'chain.broken.bad_seq',
  bad_version: 'chain.broken.bad_version',
  truncated: 'chain.broken.truncated',
} as const;

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(new Error('read failed'));
    };
    reader.readAsText(file);
  });
}

function shortHash(h: string): string {
  return `${h.slice(0, 12)}...${h.slice(-6)}`;
}

/** The verdict as words first; the edge colour only backs it up. */
export function ChainBadge({ verdict }: { verdict: ChainVerdict }) {
  switch (verdict.kind) {
    case 'verified':
      return (
        <div className="gv-chain__verdict" data-verdict="verified" role="status">
          <p className="gv-chain__badge">{t('chain.verified')}</p>
          <p>{t('chain.verified.detail', { count: verdict.count })}</p>
          {!verdict.closed && <p>{t('chain.verified.open')}</p>}
          <p className="gv-chain__head">
            {t('chain.head')} <code>{shortHash(verdict.headHash)}</code>
          </p>
        </div>
      );
    case 'broken':
      return (
        <div className="gv-chain__verdict" data-verdict="broken" role="alert">
          <p className="gv-chain__badge">{t('chain.broken', { n: verdict.entry })}</p>
          <p>{t(BROKEN_DETAIL[verdict.reason], { n: verdict.entry })}</p>
        </div>
      );
    case 'invalid':
      return (
        <div className="gv-chain__verdict" data-verdict="invalid" role="status">
          <p className="gv-chain__badge">{t('chain.invalid')}</p>
          <p>{t('chain.invalid.detail')}</p>
        </div>
      );
    case 'none':
      return (
        <div className="gv-chain__verdict" data-verdict="none" role="status">
          <p className="gv-chain__badge">{t('chain.none')}</p>
          <p>{t('chain.none.detail')}</p>
        </div>
      );
  }
}

/** Verifies the hash-chained ledger in the browser and explains the result for a judge. */
export function ChainCheck({ ledger, allowFile = false }: ChainCheckProps) {
  const [picked, setPicked] = useState<unknown>(undefined);
  const source = picked === undefined ? ledger : picked;
  const verdict = useMemo(() => verifyLedger(source), [source]);

  const onFile = (file: File | undefined): void => {
    if (file === undefined) return;
    void readText(file).then(
      (text) => {
        try {
          setPicked(JSON.parse(text) as unknown);
        } catch {
          setPicked(false);
        }
      },
      () => {
        setPicked(false);
      },
    );
  };

  return (
    <section className="gv-chain" aria-labelledby="gv-chain-title" data-testid="chain-check">
      <h2 id="gv-chain-title">{t('chain.title')}</h2>
      <ChainBadge verdict={verdict} />
      {allowFile && (
        <div className="gv-chain__file">
          <label htmlFor="gv-chain-file">{t('chain.file.label')}</label>
          <input
            id="gv-chain-file"
            type="file"
            accept="application/json,.json"
            aria-describedby="gv-chain-file-hint"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
            }}
          />
          <small id="gv-chain-file-hint">{t('chain.file.hint')}</small>
        </div>
      )}
      <details className="gv-chain__explain">
        <summary>{t('chain.explain.summary')}</summary>
        <p>{t('chain.explain.proves')}</p>
        <p>{t('chain.explain.notProves')}</p>
      </details>
    </section>
  );
}
