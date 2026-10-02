'use client';

import {
  BarChart3,
  CheckCircle2,
  FileText,
  Gauge,
  Hash,
  Ruler,
  Search,
  Timer,
} from 'lucide-react';

import { createColumnConfigHelper } from '@/components/data-table-filter/core/filters';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import {
  numberFilterFn,
  optionFilterFn,
  textFilterFn,
} from '@/components/data-table-filter/lib/filter-fns';
import type { FinbenchRunPublic } from '@/lib/finbench/snapshot';

/**
 * Filterable run columns for the data-table-filter engine (ported from the
 * Circle project). Accessors return the raw values the filter functions
 * compare against; the published snapshot is client data with no ground-truth
 * answers (INV-3/INV-6), so filtering stays local to the browser.
 */

export type RunResultKind = 'pass' | 'miss' | 'groundedness';

export function runResultKind(run: FinbenchRunPublic): RunResultKind {
  if (run.numeric_accuracy === null || run.numeric_accuracy === undefined) {
    return 'groundedness';
  }
  return run.numeric_accuracy ? 'pass' : 'miss';
}

export const RUN_RESULT_OPTIONS: { value: RunResultKind; label: string }[] = [
  { value: 'pass', label: 'numeric pass' },
  { value: 'miss', label: 'numeric miss' },
  { value: 'groundedness', label: 'groundedness only' },
];

const dtf = createColumnConfigHelper<FinbenchRunPublic>();

/** Filterable columns for the run records table. */
export const runFilterColumns = [
  dtf
    .option()
    .id('model')
    .accessor((run) => run.model_version)
    .displayName('Model')
    .icon(Hash)
    // Model versions arrive from the snapshot as plain strings; wrap them
    // into ColumnOptions so the engine can derive options on the client.
    .transformOptionFn((value) => ({ value, label: String(value) }))
    .build(),
  dtf
    .option()
    .id('result')
    .accessor((run) => runResultKind(run))
    .displayName('Result')
    .icon(CheckCircle2)
    .options(RUN_RESULT_OPTIONS)
    .build(),
  dtf
    .text()
    .id('task_id')
    .accessor((run) => run.task_id)
    .displayName('Task')
    .icon(Search)
    .build(),
  dtf
    .text()
    .id('judge_rationale')
    .accessor((run) => run.judge_rationale)
    .displayName('Judge rationale')
    .icon(FileText)
    .build(),
  dtf
    .number()
    .id('latency_ms')
    .accessor((run) => run.latency_ms)
    .displayName('Latency')
    .icon(Timer)
    .build(),
  dtf
    .number()
    .id('groundedness_score')
    .accessor((run) => run.groundedness_score)
    .displayName('Groundedness')
    .icon(Gauge)
    .build(),
  dtf
    .number()
    .id('citation_validity')
    .accessor((run) => run.citation_validity)
    .displayName('Citation validity')
    .icon(Ruler)
    .build(),
  dtf
    .number()
    .id('structure_score')
    .accessor((run) => run.structure_score)
    .displayName('Structure')
    .icon(BarChart3)
    .build(),
] as const;

const columnById = new Map<string, (typeof runFilterColumns)[number]>(
  runFilterColumns.map((column) => [column.id, column]),
);

/**
 * Applies a FiltersState to a list of runs, honoring the operator of each
 * filter (is / is not / contains / is between / …). Mirrors Circle's
 * applyIssueFilters pattern.
 */
export function applyRunFilters(
  runs: FinbenchRunPublic[],
  filters: FiltersState,
): FinbenchRunPublic[] {
  if (filters.length === 0) return runs;

  return runs.filter((run) =>
    filters.every((filter) => {
      const column = columnById.get(filter.columnId);
      if (!column) return true;

      const value = column.accessor(run);
      switch (filter.type) {
        case 'option':
          return optionFilterFn(String(value ?? ''), filter) ?? true;
        case 'text':
          return textFilterFn(String(value ?? ''), filter) ?? true;
        case 'number':
          return numberFilterFn(Number(value ?? 0), filter) ?? true;
        default:
          return true;
      }
    }),
  );
}

/** Derives faceted value/count maps for option columns from the full run set. */
export function runFacetedOptions(
  runs: FinbenchRunPublic[],
): Record<string, Map<string, number>> {
  const maps: Record<string, Map<string, number>> = {
    model: new Map(),
    result: new Map(),
  };
  for (const run of runs) {
    const model = maps.model.get(run.model_version) ?? 0;
    maps.model.set(run.model_version, model + 1);
    const kind = runResultKind(run);
    const result = maps.result.get(kind) ?? 0;
    maps.result.set(kind, result + 1);
  }
  return maps;
}
