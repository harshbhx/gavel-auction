import { useCallback, useEffect, useState } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import {
  EMPTY_FILTERS,
  OUTCOMES,
  SOURCES,
  filtersToSearch,
  hasActiveFilters,
  parseFilters,
  type AuditFilters,
} from './filters';

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
    const search = filtersToSearch(next);
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
