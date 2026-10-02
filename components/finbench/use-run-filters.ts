'use client';

import type {
  FilterModel,
  FiltersState,
} from '@/components/data-table-filter/core/types';
import { createParser, useQueryState } from 'nuqs';
import { useCallback } from 'react';

/**
 * FinBench run filters, synced to the URL via nuqs under a single `?filters=`
 * param (ported from Circle's store/filter-store.ts). The state shape is the
 * data-table-filter engine's FiltersState (an array of
 * `{ columnId, type, operator, values }`), so operators like "is not" and
 * "is between" survive in shareable URLs.
 */

const isFilterModel = (value: unknown): value is FilterModel => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.columnId === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.operator === 'string' &&
    Array.isArray(candidate.values)
  );
};

const filtersParser = createParser<FiltersState>({
  parse: (value) => {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(isFilterModel);
    } catch {
      return null;
    }
  },
  serialize: (value) => JSON.stringify(value),
  eq: (a, b) => JSON.stringify(a) === JSON.stringify(b),
}).withDefault([]);

export function useRunFilterState() {
  const [filters, setFiltersState] = useQueryState('filters', filtersParser);

  /** Controlled setter, compatible with useDataTableFilters' onFiltersChange. */
  const setFilters = useCallback<React.Dispatch<React.SetStateAction<FiltersState>>>(
    (action) => {
      void setFiltersState((previous) => {
        const next = typeof action === 'function' ? action(previous) : action;
        return next.length > 0 ? next : null;
      });
    },
    [setFiltersState],
  );

  return { filters, setFilters };
}
