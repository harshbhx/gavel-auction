import type { GridApi } from 'ag-grid-community';
import { useEffect, useId, useState } from 'react';

import { t } from '../copy/t';
import { Button } from '../design/primitives/Button';
import { actorLabel } from './labels';
import type { FilterModel } from './urlState';

export interface TypeOption {
  value: string;
  label: string;
}

interface Fields {
  type: string;
  paddle: string;
  hash: string;
}

function textFilter(model: FilterModel, col: string): string {
  const f = model[col];
  if (typeof f !== 'object' || f === null) return '';
  const v = (f as { filter?: unknown }).filter;
  return typeof v === 'string' ? v : '';
}

/** The friendly inputs that the AG Grid filter model currently holds. */
export function fieldsFromModel(model: FilterModel): Fields {
  const actor = textFilter(model, 'actor');
  return {
    type: textFilter(model, 'type'),
    paddle: /(\d+)$/.exec(actor)?.[1] ?? '',
    hash: textFilter(model, 'hash'),
  };
}

function withText(
  model: FilterModel,
  col: string,
  kind: 'equals' | 'startsWith',
  value: string,
): FilterModel {
  const rest = Object.fromEntries(Object.entries(model).filter(([k]) => k !== col));
  return value === ''
    ? rest
    : { ...rest, [col]: { filterType: 'text', type: kind, filter: value } };
}

/**
 * Three plain filters for the ledger (event, paddle, hash prefix). They write into the grid's own
 * column filters, so the header filter menus show the same values and a link can carry them.
 */
export function LedgerFilterBar({
  api,
  model,
  types,
  showHash,
  showPaddle,
  linkable,
}: {
  api: GridApi | null;
  model: FilterModel;
  types: readonly TypeOption[];
  showHash: boolean;
  showPaddle: boolean;
  /** Offer the "copy link" button (the filters are in the URL). */
  linkable: boolean;
}) {
  const ids = [useId(), useId(), useId()] as const;
  const [fields, setFields] = useState<Fields>(() => fieldsFromModel(model));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setFields(fieldsFromModel(model));
  }, [model]);

  const apply = (patch: Partial<Fields>): void => {
    const next = { ...fields, ...patch };
    setFields(next);
    if (api === null) return;
    let m: FilterModel = { ...api.getFilterModel() };
    m = withText(m, 'type', 'equals', next.type);
    m = withText(
      m,
      'actor',
      'equals',
      next.paddle === '' ? '' : actorLabel(`paddle:${next.paddle}`),
    );
    m = withText(m, 'hash', 'startsWith', next.hash);
    api.setFilterModel(Object.keys(m).length === 0 ? null : m);
  };

  const copyLink = (): void => {
    navigator.clipboard.writeText(window.location.href).then(
      () => {
        setNotice(t('grid.filter.linked'));
      },
      () => {
        setNotice(t('grid.filter.linkFailed'));
      },
    );
  };

  return (
    <form
      className="gv-gridfilters"
      role="search"
      aria-label={t('grid.filter.region')}
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <div>
        <label htmlFor={ids[0]}>{t('grid.filter.type')}</label>
        <select
          id={ids[0]}
          value={fields.type}
          onChange={(e) => {
            apply({ type: e.currentTarget.value });
          }}
        >
          <option value="">{t('grid.filter.typeAny')}</option>
          {types.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {showPaddle && (
        <div>
          <label htmlFor={ids[1]}>{t('grid.filter.paddle')}</label>
          <input
            id={ids[1]}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={t('grid.filter.paddleHint')}
            value={fields.paddle}
            onChange={(e) => {
              apply({ paddle: e.currentTarget.value.replace(/\D/g, '').slice(0, 6) });
            }}
          />
        </div>
      )}
      {showHash && (
        <div>
          <label htmlFor={ids[2]}>{t('grid.filter.hash')}</label>
          <input
            id={ids[2]}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('grid.filter.hashHint')}
            value={fields.hash}
            onChange={(e) => {
              apply({ hash: e.currentTarget.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 64) });
            }}
          />
        </div>
      )}
      {linkable && (
        <Button variant="outline" tone="neutral" onClick={copyLink}>
          {t('grid.filter.link')}
        </Button>
      )}
      {notice !== null && <p role="status">{notice}</p>}
    </form>
  );
}
