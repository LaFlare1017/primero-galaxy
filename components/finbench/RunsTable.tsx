'use client';

import { ArrowUpDown } from 'lucide-react';
import { parseAsStringEnum, parseAsStringLiteral, useQueryState } from 'nuqs';
import { useMemo } from 'react';

import { DataTableFilter } from '@/components/data-table-filter/components/data-table-filter';
import { useDataTableFilters } from '@/components/data-table-filter/hooks/use-data-table-filters';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import { SavedViews } from '@/components/finbench/SavedViews';
import { useRunFilterState } from '@/components/finbench/use-run-filters';
import {
  applyRunFilters,
  runFacetedOptions,
  runFilterColumns,
} from '@/components/finbench/run-filter-columns';
import { Badge } from '@/components/ui/primitives/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives/table';
import { cn } from '@/lib/utils';
import type { FinbenchRunPublic, FinbenchTaskPublic, FinbenchTrack } from '@/lib/finbench/snapshot';

/**
 * Run-records explorer for the FinBench dashboard, built on the full
 * data-table-filter engine ported from the Circle project: subject /
 * operator / value filter chips, numeric and text operators, faceted
 * counts, and URL-synced filter state (shareable deep links). Client-side
 * filtering over the published snapshot; the snapshot carries no
 * ground-truth answers (INV-3/INV-6).
 */

type SortKey = 'task_id' | 'model_version' | 'latency_ms';

const SORT_KEYS: SortKey[] = ['task_id', 'model_version', 'latency_ms'];

/**
 * Column sort in the URL (the last table state in the repo that was still
 * component-local): ?sort=<key>&dir=desc, mirroring the facilitator
 * console's conventions. Defaults drop out via clearOnDefault, so a clean
 * view shares as a param-free URL and a saved view replays into exactly
 * the URL shape it was saved from.
 */
const sortKeyParser = parseAsStringEnum<SortKey>(SORT_KEYS).withDefault('task_id');
const sortDirParser = parseAsStringLiteral(['asc', 'desc'] as const).withDefault('asc');

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function ResultBadge({ run }: { run: FinbenchRunPublic }) {
  if (run.numeric_accuracy === null || run.numeric_accuracy === undefined) {
    return (
      <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
        groundedness
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[11px] font-normal',
        run.numeric_accuracy ? 'text-maturity-high' : 'text-maturity-low',
      )}
    >
      {run.numeric_accuracy ? 'pass' : 'miss'}
    </Badge>
  );
}

export function RunsTable({
  runs,
  tasks,
  track,
}: {
  runs: FinbenchRunPublic[];
  tasks: FinbenchTaskPublic[];
  track: FinbenchTrack;
}) {
  const categoryByTask = useMemo(() => {
    const map = new Map<string, FinbenchTaskPublic>();
    for (const task of tasks) map.set(task.id, task);
    return map;
  }, [tasks]);

  const faceted = useMemo(() => runFacetedOptions(runs), [runs]);

  const urlState = useRunFilterState();

  const { columns, filters, actions, strategy } = useDataTableFilters({
    strategy: 'client',
    data: runs,
    columnsConfig: runFilterColumns,
    faceted,
    filters: urlState.filters,
    onFiltersChange: urlState.setFilters,
  });

  const [sortKey, setSortKey] = useQueryState('sort', sortKeyParser);
  const [sortDir, setSortDir] = useQueryState('dir', sortDirParser);
  const sort = { key: sortKey, desc: sortDir === 'desc' };

  const filtered = useMemo(() => {
    const rows = applyRunFilters(runs, filters);
    const desc = sortDir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      if (sortKey === 'latency_ms') return (a.latency_ms - b.latency_ms) * desc;
      return a[sortKey].localeCompare(b[sortKey]) * desc;
    });
    return rows;
  }, [runs, filters, sortKey, sortDir]);

  function sortButton(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <button
        type="button"
        aria-label={`Sort by ${label}`}
        onClick={() => {
          const nextDesc = active ? sortDir !== 'desc' : false;
          void setSortKey(key);
          void setSortDir(nextDesc ? 'desc' : 'asc');
        }}
        className={cn('inline-flex items-center gap-1 hover:text-foreground', active && 'text-foreground')}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-nebula/40">
      <div className="border-b border-border-subtle p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <DataTableFilter
              columns={columns}
              filters={filters}
              actions={actions}
              strategy={strategy}
            />
          </div>
          {/* Named filter combinations (Circle views pattern): stored in
              localStorage, applied through the same ?filters= pipeline. */}
          <SavedViews track={track} filters={filters} onApply={urlState.setFilters} />
        </div>
        <div className="mt-2 flex items-center justify-end">
          <span className="text-xs tabular-nums text-muted-foreground">
            {filtered.length} of {runs.length} runs
          </span>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{sortButton('task_id', 'Task')}</TableHead>
            <TableHead>{sortButton('model_version', 'Model')}</TableHead>
            <TableHead>Result</TableHead>
            <TableHead className="text-right">Groundedness</TableHead>
            <TableHead className="text-right">Citations</TableHead>
            <TableHead className="text-right">Structure</TableHead>
            <TableHead className="text-right">{sortButton('latency_ms', 'Latency')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                No runs match the current filters.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="font-mono text-[12.5px]">
                  {run.task_id}
                  <span className="ml-2 font-sans text-[11px] text-muted-foreground">
                    {categoryByTask.get(run.task_id)?.category ?? ''}
                  </span>
                </TableCell>
                <TableCell className="text-[13px]">{run.model_version}</TableCell>
                <TableCell>
                  <ResultBadge run={run} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{percent(run.groundedness_score)}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(run.citation_validity)}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(run.structure_score)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {(run.latency_ms / 1000).toFixed(1)}s
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
