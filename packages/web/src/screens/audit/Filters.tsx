import { useCallback, useEffect, useState } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import {
  EMPTY_FILTERS,
  OUTCOMES,
  SINCE_OPTIONS,
  SOURCES,
  filtersToSearch,
  hasActiveFilters,
  parseFilters,
  type AuditFilters,
} from './filters';
import { TRAIL_KINDS } from './trail';

/** Filters kept in the page query string, so a filtered view is a shareable link. */
export function useUrlFilters(): readonly [AuditFilters, (next: AuditFilters) => void] {
  const [filters, setFilters] = useState<AuditFilters>(() => parseFilters(window.location.search));

  useEffect(() => {
    const onPop = (): void => setFilters(parseFilters(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const update = useCallback((next: AuditFilters) => {
    setFilters(next);
    // Keep the ledger grid's own keys (gq, gf) that share this query string.
    const keep = new URLSearchParams(window.location.search);
    const merged = new URLSearchParams(filtersToSearch(next));
    for (const key of ['gq', 'gf']) {
      const v = keep.get(key);
      if (v !== null) merged.set(key, v);
    }
    const search = merged.toString();
    const url = `${window.location.pathname}${search === '' ? '' : `?${search}`}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
  }, []);

  return [filters, update] as const;
}

export interface FiltersProps {
  filters: AuditFilters;
  onChange: (next: AuditFilters) => void;
}

function numberOrNull(value: string): number | null {
  return /^\d{1,6}$/.test(value) ? Number(value) : null;
}

export function Filters({ filters, onChange }: FiltersProps) {
  const set = (patch: Partial<AuditFilters>): void => onChange({ ...filters, ...patch });
  return (
    <form
      className="gv-audit-filters"
      role="search"
      aria-label={t('audit.filters')}
      onSubmit={(e) => e.preventDefault()}
    >
      <label>
        <span>{t('audit.filter.type')}</span>
        <select
          value={filters.type ?? ''}
          onChange={(e) => set({ type: TRAIL_KINDS.find((k) => k === e.target.value) ?? null })}
        >
          <option value="">{t('audit.filter.any')}</option>
          {TRAIL_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`audit.kind.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <Field
        label={t('audit.filter.paddle')}
        inputMode="numeric"
        value={filters.paddle === null ? '' : String(filters.paddle)}
        onChange={(e) => set({ paddle: numberOrNull(e.target.value) })}
      />
      <label>
        <span>{t('audit.filter.result')}</span>
        <select
          value={filters.outcome ?? ''}
          onChange={(e) => set({ outcome: OUTCOMES.find((o) => o === e.target.value) ?? null })}
        >
          <option value="">{t('audit.filter.any')}</option>
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {t(`audit.outcome.${o}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t('audit.filter.source')}</span>
        <select
          value={filters.source ?? ''}
          onChange={(e) => set({ source: SOURCES.find((s) => s === e.target.value) ?? null })}
        >
          <option value="">{t('audit.filter.any')}</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`audit.source.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <Field
        label={t('audit.filter.confidence')}
        inputMode="numeric"
        value={filters.confidenceBelow === null ? '' : String(filters.confidenceBelow)}
        onChange={(e) => {
          const n = numberOrNull(e.target.value);
          set({ confidenceBelow: n !== null && n <= 100 ? n : null });
        }}
      />
      <label>
        <span>{t('audit.filter.since')}</span>
        <select
          value={filters.sinceMin === null ? '' : String(filters.sinceMin)}
          onChange={(e) =>
            set({ sinceMin: SINCE_OPTIONS.find((m) => String(m) === e.target.value) ?? null })
          }
        >
          <option value="">{t('audit.since.any')}</option>
          {SINCE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {t(`audit.since.m${m}`)}
            </option>
          ))}
        </select>
      </label>
      <Field
        label={t('audit.filter.text')}
        type="search"
        value={filters.text}
        onChange={(e) => set({ text: e.target.value })}
      />
      {hasActiveFilters(filters) && (
        <Button variant="outline" tone="neutral" onClick={() => onChange(EMPTY_FILTERS)}>
          {t('audit.clear')}
        </Button>
      )}
    </form>
  );
}
