import type { Metadata } from 'next';
import Link from 'next/link';
import { RunsTable } from '@/components/finbench/RunsTable';
import {
  FINDING_KIND_LABELS,
  TRACKS,
  cellMetric,
  loadSnapshot,
  type FinbenchFindingKind,
  type FinbenchTrack,
} from '@/lib/finbench/snapshot';

export const metadata: Metadata = {
  title: 'FinBench: Independent AI Accounting Benchmark',
  description:
    'A repeatable, monthly benchmark of frontier AI models on ASC 606 revenue recognition and govcon/DCAA compliance tasks. Every published claim links to an inspectable task set, rubric, and scoring code.',
  alternates: { canonical: '/finbench' },
};

const TRACK_TABS: Record<FinbenchTrack, string> = {
  asc606: 'ASC 606',
  govcon: 'Govcon / DCAA',
};

export default async function FinbenchOverview({
  searchParams,
}: {
  searchParams: Promise<{ track?: string; month?: string }>;
}) {
  const params = await searchParams;
  const track = (params.track === 'govcon' ? 'govcon' : 'asc606') as FinbenchTrack;
  const snapshot = await loadSnapshot(track);

  if (!snapshot) {
    return (
      <main className="mx-auto min-h-[100svh] max-w-3xl bg-void px-6 py-24">
        <p className="font-mono text-[12px] tracking-[0.14em] text-trajectory">
          FINBENCH
        </p>
        <h1 className="mt-4 text-4xl font-extrabold tracking-[-0.03em] text-star-bright">
          No published run yet
        </h1>
        <p className="mt-5 max-w-[58ch] text-[15.5px] leading-relaxed text-star-bright/70">
          The benchmark harness exists and has been executed locally, but no
          monthly snapshot has been published to the site yet. Published runs
          appear here with their full task set, model roster, and scoring
          methodology, never a bare number.
        </p>
        <div className="mt-8 rounded-xl border border-dashed border-border-subtle p-5 font-mono text-[12.5px] leading-relaxed text-[var(--ui-dim)]">
          <div>PYTHONPATH=. python3 -m finbench.cli run --track {track} \</div>
          <div className="pl-4">--month 2026-12</div>
          <div className="mt-3 text-[var(--ui-muted)]"># then publish the snapshot:</div>
          <div>PYTHONPATH=. python3 -m finbench.cli export-web --track {track} \</div>
          <div className="pl-4">--month 2026-12 --out public/finbench/{track}.json</div>
        </div>
        <Link
          href="/"
          prefetch={false}
          className="mt-10 inline-block rounded-lg border border-border-subtle px-6 py-3 text-[14px] text-[var(--ui-dim)] transition-colors hover:border-trajectory hover:text-star-bright"
        >
          ← Back to Primero Galaxy
        </Link>
      </main>
    );
  }

  const modelEntries = Object.entries(snapshot.scorecard.models);
  const categoryEntries = Object.entries(snapshot.scorecard.categories);
  const monthLabel = new Date(`${snapshot.month}-15`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <main className="mx-auto min-h-[100svh] max-w-5xl bg-void px-6 py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[12px] tracking-[0.14em] text-trajectory">
            FINBENCH · MONTHLY BENCHMARK
          </p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.03em] text-star-bright md:text-5xl">
            {TRACK_TABS[track]}{' '}
            <span className="text-[var(--ui-muted)]">·</span>{' '}
            <span className="text-[var(--ui-dim)]">{monthLabel}</span>
          </h1>
        </div>
        <Link
          href="/finbench/methodology"
          prefetch={false}
          className="rounded-lg border border-border-subtle px-5 py-2.5 text-[13px] text-[var(--ui-dim)] transition-colors hover:border-trajectory hover:text-star-bright"
        >
          Methodology & downloads
        </Link>
      </div>

      <nav aria-label="Benchmark tracks" className="mt-8 flex gap-2">
        {TRACKS.map((t) => (
          <Link
            key={t.id}
            href={`/finbench?track=${t.id}`}
            prefetch={false}
            aria-current={t.id === track ? 'page' : undefined}
            className={`rounded-lg border px-4 py-2 text-[13px] transition-colors ${
              t.id === track
                ? 'border-trajectory bg-trajectory/10 text-star-bright'
                : 'border-border-subtle text-[var(--ui-dim)] hover:border-trajectory hover:text-star-bright'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <p className="mt-8 max-w-[62ch] text-[15px] leading-relaxed text-star-bright/70">
        Version-pinned frontier models evaluated on original, independently
        authored {TRACK_TABS[track]} tasks. Scores come from a deterministic
        judge against a static citation lookup; every number on this page
        links to the exact task and run that produced it.
      </p>

      {/* ─── Model summary cards ─────────────────────────────── */}
      <section aria-label="Model summary" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modelEntries.map(([key, summary]) => {
          const separator = key.indexOf(':');
          const provider = separator === -1 ? key : key.slice(0, separator);
          const version = separator === -1 ? key : key.slice(separator + 1);
          return (
            <div
              key={key}
              className="rounded-xl border border-border-subtle bg-white/[0.02] p-5"
            >
              <p className="font-mono text-[12px] text-[var(--ui-dim)]">
                {provider} <span className="text-[var(--ui-muted)]">·</span>{' '}
                <span className="text-trajectory">{version}</span>
              </p>
              <p className="mt-3 text-3xl font-extrabold tabular-nums text-star-bright">
                {summary.numeric_accuracy === null
                  ? `${Math.round(summary.groundedness * 100)}%`
                  : `${Math.round(summary.numeric_accuracy * 100)}%`}
              </p>
              <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--ui-muted)]">
                {summary.numeric_accuracy === null ? 'Groundedness (no numeric items)' : 'Numeric accuracy'} · n={summary.tasks}
              </p>
              <dl className="mt-4 space-y-1.5 text-[12px] text-[var(--ui-dim)]">
                <div className="flex justify-between">
                  <dt>Citation validity</dt>
                  <dd className="tabular-nums">{Math.round(summary.citation_validity * 100)}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Structure</dt>
                  <dd className="tabular-nums">{Math.round(summary.structure * 100)}%</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </section>

      {/* ─── Month-over-month trend ──────────────────────────── */}
      {snapshot.trend.prior_month && (
        <section aria-label="Month-over-month trend" className="mt-12">
          <h2 className="text-xl font-bold text-star-bright">
            Trend vs. {new Date(`${snapshot.trend.prior_month}-15`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h2>
          <p className="mt-2 max-w-[58ch] text-[13.5px] leading-relaxed text-[var(--ui-dim)]">
            Headline metric (numeric accuracy where applicable, groundedness
            otherwise) compared to the prior published run.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(snapshot.trend.models).map(([key, trend]) => {
              const [provider, version] = key.split(':');
              return (
                <div
                  key={key}
                  className="rounded-xl border border-border-subtle bg-white/[0.02] px-5 py-4"
                >
                  <p className="font-mono text-[12px] text-trajectory">
                    {provider}
                  </p>
                  <p className="font-mono text-[11px] text-[var(--ui-muted)]">
                    {version}
                  </p>
                  <div className="mt-3 flex items-baseline gap-3">
                    <span className="text-2xl font-extrabold tabular-nums text-star-bright">
                      {Math.round(trend.current * 100)}%
                    </span>
                    {trend.change !== null && (
                      <span
                        className={`font-mono text-[13px] font-medium ${
                          trend.change > 0
                            ? 'text-maturity-mid'
                            : trend.change < 0
                              ? 'text-maturity-low'
                              : 'text-[var(--ui-muted)]'
                        }`}
                      >
                        {trend.change > 0 ? '+' : ''}{Math.round(trend.change * 100)} pts
                      </span>
                    )}
                  </div>
                  {trend.prior !== null && (
                    <p className="mt-1 font-mono text-[10.5px] text-[var(--ui-muted)]">
                      was {Math.round(trend.prior * 100)}%
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── Category × model matrix ─────────────────────────── */}
      <section aria-label="Category breakdown" className="mt-12">
        <h2 className="text-xl font-bold text-star-bright">Category breakdown</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-border-subtle">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border-subtle bg-white/[0.03] text-left font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                <th className="px-4 py-3 font-medium">Category</th>
                {modelEntries.map(([key]) => (
                  <th key={key} className="px-4 py-3 text-right font-medium">
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categoryEntries.map(([category, summary]) => (
                <tr key={category} className="border-b border-border-subtle/60 last:border-0">
                  <td className="px-4 py-3 text-star-bright">
                    {category.replace(/_/g, ' ')}
                    <span className="ml-2 font-mono text-[10.5px] text-[var(--ui-muted)]">n={summary.tasks}</span>
                  </td>
                  {modelEntries.map(([modelKey]) => {
                    const runs = snapshot.runs.filter((r) => {
                      const taskCategory = r.task_id.replace(/-\d+$/, '');
                      return (
                        `${r.model_provider}:${r.model_version}` === modelKey &&
                        taskCategory === category
                      );
                    });
                    const metric = runs.length > 0 ? cellMetric(runs) : null;
                    return (
                      <td key={modelKey} className="px-4 py-3 text-right tabular-nums text-star-bright/85">
                        {metric === null ? 'n/a' : `${Math.round(metric.value * 100)}%`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── Findings from this run ──────────────────────────── */}
      {snapshot.findings.length > 0 && (
        <section aria-labelledby="findings-heading" className="mt-12">
          <h2 id="findings-heading" className="text-xl font-bold text-star-bright">
            Findings from this run
          </h2>
          <p className="mt-2 max-w-[58ch] text-[13.5px] leading-relaxed text-[var(--ui-dim)]">
            Every finding is computed by deterministic rules over the run
            records; no model generates findings. Each statement is
            falsifiable against the task and run evidence linked below it.
          </p>
          <ul className="mt-6 space-y-3">
            {snapshot.findings.map((finding, index) => (
              <li
                key={`${finding.kind}-${finding.model_version}-${finding.task_ids.join(',')}-${index}`}
                className="rounded-xl border border-border-subtle bg-white/[0.02] px-5 py-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] ${
                      finding.kind === 'numeric_miss'
                        ? 'border-maturity-low/40 text-maturity-low'
                        : 'border-trajectory/40 text-trajectory'
                    }`}
                  >
                    {FINDING_KIND_LABELS[finding.kind as FinbenchFindingKind] ?? finding.kind}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--ui-muted)]">
                    {finding.model_version}
                  </span>
                </div>
                <p className="mt-2.5 text-[14px] leading-relaxed text-star-bright/85">
                  {finding.statement}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ui-muted)]">
                    Evidence:
                  </span>
                  {finding.task_ids.map((taskId) => (
                    <Link
                      key={taskId}
                      href={`/finbench/tasks/${taskId}`}
                      prefetch={false}
                      className="rounded-lg border border-border-subtle px-2.5 py-1 font-mono text-[11.5px] text-trajectory transition-colors hover:border-trajectory hover:text-star-bright"
                    >
                      {taskId}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── Task index ──────────────────────────────────────── */}
      <section aria-label="Task set" className="mt-12">
        <h2 className="text-xl font-bold text-star-bright">
          The task set ({snapshot.tasks.length} tasks)
        </h2>
        <p className="mt-2 max-w-[58ch] text-[13.5px] leading-relaxed text-[var(--ui-dim)]">
          Every task is original or derived only from public regulatory text.
          Ground truth is computed independently before any model sees the
          task; expected answers are not published here, to keep the set
          usable month over month.
        </p>
        <ul className="mt-6 divide-y divide-border-subtle/60 rounded-xl border border-border-subtle">
          {snapshot.tasks.map((task) => (
            <li key={task.id}>
              <Link
                href={`/finbench/tasks/${task.id}`}
                prefetch={false}
                className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4 transition-colors hover:bg-white/[0.03]"
              >
                <span className="font-mono text-[13px] text-trajectory">{task.id}</span>
                <span className="text-[13px] text-star-bright/80">
                  {task.category.replace(/_/g, ' ')}{' '}
                  <span className="font-mono text-[11px] text-[var(--ui-muted)]">
                    · {task.difficulty} · {task.provenance}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── Run-level evidence ──────────────────────────────── */}
      <section aria-label="Run records" className="mt-12 pb-8">
        <h2 className="text-xl font-bold text-star-bright">Run records</h2>
        <p className="mt-2 max-w-[58ch] text-[13.5px] leading-relaxed text-[var(--ui-dim)]">
          Immutable, version-pinned records. Historical runs are never edited;
          corrections are appended and superseded records stay inspectable.
          Filter and sort to inspect any subset.
        </p>
        {/* Circle-extracted UI kit: faceted filters + sortable table. */}
        <div className="mt-6">
          <RunsTable runs={snapshot.runs} tasks={snapshot.tasks} track={track} />
        </div>
      </section>
    </main>
  );
}
