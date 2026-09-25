'use client';

import { ArrowUpDown, ChevronDown, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Checkbox } from '@/components/ui/primitives/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/primitives/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives/table';
import { cn } from '@/lib/utils';
import type { FinbenchRunPublic, FinbenchTaskPublic } from '@/lib/finbench/snapshot';

/**
 * Run-records explorer for the FinBench dashboard, built on the UI kit
 * extracted from the Circle project (shadcn primitives + the faceted
 * filter pattern: popover + command multi-select + active-filter badges).
 * Client-side filtering over the published snapshot; the snapshot carries
 * no ground-truth answers (INV-3/INV-6).
 */

type SortKey = 'task_id' | 'model_version' | 'latency_ms';

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Faceted multi-select filter, Circle data-table-filter style. */
function FacetFilter({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: { value: string; label: string; count: number }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-border text-[13px] font-normal">
          <span className="text-muted-foreground">{label}</span>
          {selected.size > 0 ? (
            <>
              <span className="mx-1 h-4 w-px shrink-0 bg-border" />
              <span className="tabular-nums">{selected.size}</span>
            </>
          ) : null}
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option.value} onSelect={() => onToggle(option.value)}>
                  {/* Visual state only: the item's onSelect owns the toggle, so a
                      direct click on the box cannot fire both handlers and
                      cancel itself out. */}
                  <Checkbox
                    checked={selected.has(option.value)}
                    className="mr-2 pointer-events-none"
                  />
                  <span className="flex-1 truncate">{option.label}</span>
                  <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                    {option.count}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.size > 0 && (
          <div className="border-t border-border p-1">
            <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={onClear}>
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
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
        run.numeric_accuracy ? 'text-maturity-high' : 'text-maturity-low'
      )}
    >
      {run.numeric_accuracy ? 'pass' : 'miss'}
    </Badge>
  );
}

export function RunsTable({
  runs,
  tasks,
}: {
  runs: FinbenchRunPublic[];
  tasks: FinbenchTaskPublic[];
}) {
  const categoryByTask = useMemo(() => {
    const map = new Map<string, FinbenchTaskPublic>();
    for (const task of tasks) map.set(task.id, task);
    return map;
  }, [tasks]);

  const [modelFilter, setModelFilter] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [resultFilter, setResultFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'task_id', desc: false });

  const modelOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of runs) counts.set(run.model_version, (counts.get(run.model_version) ?? 0) + 1);
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [runs]);

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of runs) {
      const category = categoryByTask.get(run.task_id)?.category ?? 'unknown';
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [runs, categoryByTask]);

  const resultOptions = useMemo(() => {
    const counts = { pass: 0, miss: 0, groundedness: 0 };
    for (const run of runs) {
      if (run.numeric_accuracy === null || run.numeric_accuracy === undefined) counts.groundedness += 1;
      else if (run.numeric_accuracy) counts.pass += 1;
      else counts.miss += 1;
    }
    return [
      { value: 'pass', label: 'numeric pass', count: counts.pass },
      { value: 'miss', label: 'numeric miss', count: counts.miss },
      { value: 'groundedness', label: 'groundedness only', count: counts.groundedness },
    ];
  }, [runs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = runs.filter((run) => {
      if (modelFilter.size > 0 && !modelFilter.has(run.model_version)) return false;
      if (categoryFilter.size > 0 && !categoryFilter.has(categoryByTask.get(run.task_id)?.category ?? 'unknown'))
        return false;
      if (resultFilter.size > 0) {
        const kind =
          run.numeric_accuracy === null || run.numeric_accuracy === undefined
            ? 'groundedness'
            : run.numeric_accuracy
              ? 'pass'
              : 'miss';
        if (!resultFilter.has(kind)) return false;
      }
      if (q && !`${run.task_id} ${run.model_version} ${run.judge_rationale}`.toLowerCase().includes(q))
        return false;
      return true;
    });

    rows.sort((a, b) => {
      const dir = sort.desc ? -1 : 1;
      if (sort.key === 'latency_ms') return (a.latency_ms - b.latency_ms) * dir;
      return a[sort.key].localeCompare(b[sort.key]) * dir;
    });
    return rows;
  }, [runs, categoryByTask, modelFilter, categoryFilter, resultFilter, search, sort]);

  const activeCount = modelFilter.size + categoryFilter.size + resultFilter.size;
  const anyActive = activeCount > 0 || search.trim() !== '';

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>) {
    return (value: string) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
  }

  function sortButton(key: SortKey, label: string) {
    const active = sort.key === key;
    return (
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, desc: active ? !s.desc : false }))}
        className={cn('inline-flex items-center gap-1 hover:text-foreground', active && 'text-foreground')}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-nebula/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search task, model, rationale…"
          className="h-8 w-56 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
        />
        <FacetFilter
          label="Model"
          options={modelOptions}
          selected={modelFilter}
          onToggle={toggle(setModelFilter)}
          onClear={() => setModelFilter(new Set())}
        />
        <FacetFilter
          label="Category"
          options={categoryOptions}
          selected={categoryFilter}
          onToggle={toggle(setCategoryFilter)}
          onClear={() => setCategoryFilter(new Set())}
        />
        <FacetFilter
          label="Result"
          options={resultOptions}
          selected={resultFilter}
          onToggle={toggle(setResultFilter)}
          onClear={() => setResultFilter(new Set())}
        />
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {filtered.length} of {runs.length} runs
        </span>
      </div>

      {anyActive && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-3 py-2">
          {[...modelFilter].map((value) => (
            <Badge key={`m-${value}`} variant="secondary" className="gap-1 font-normal">
              {value}
              <button
                aria-label={`Remove ${value}`}
                onClick={() => toggle(setModelFilter)(value)}
                className="ml-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {[...categoryFilter].map((value) => (
            <Badge key={`c-${value}`} variant="secondary" className="gap-1 font-normal">
              {value}
              <button
                aria-label={`Remove ${value}`}
                onClick={() => toggle(setCategoryFilter)(value)}
                className="ml-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {[...resultFilter].map((value) => (
            <Badge key={`r-${value}`} variant="secondary" className="gap-1 font-normal">
              {resultOptions.find((o) => o.value === value)?.label ?? value}
              <button
                aria-label={`Remove ${value}`}
                onClick={() => toggle(setResultFilter)(value)}
                className="ml-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={() => {
              setModelFilter(new Set());
              setCategoryFilter(new Set());
              setResultFilter(new Set());
              setSearch('');
            }}
          >
            Clear all
          </Button>
        </div>
      )}

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
