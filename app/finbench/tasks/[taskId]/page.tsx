import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadSnapshot, type FinbenchTrack } from '@/lib/finbench/snapshot';

interface PageProps {
  params: Promise<{ taskId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { taskId } = await params;
  return { title: `FinBench task ${taskId}` };
}

export default async function FinbenchTaskPage({ params }: PageProps) {
  const { taskId } = await params;
  const tracks: FinbenchTrack[] = ['asc606', 'govcon'];
  for (const track of tracks) {
    const snapshot = await loadSnapshot(track);
    const task = snapshot?.tasks.find((t) => t.id === taskId);
    if (!snapshot || !task) continue;
    const runs = snapshot.runs.filter((r) => r.task_id === taskId);
    return (
      <main className="mx-auto min-h-[100svh] max-w-3xl bg-void px-6 py-16">
        <p className="font-mono text-[12px] tracking-[0.14em] text-trajectory">
          FINBENCH · TASK
        </p>
        <h1 className="mt-3 font-mono text-2xl font-extrabold text-star-bright md:text-3xl">
          {task.id}
        </h1>
        <div className="mt-4 flex flex-wrap gap-2 font-mono text-[11px]">
          <span className="rounded-full border border-border-subtle px-3 py-1 text-[var(--ui-dim)]">
            {track}
          </span>
          <span className="rounded-full border border-border-subtle px-3 py-1 text-[var(--ui-dim)]">
            {task.category.replace(/_/g, ' ')}
          </span>
          <span className="rounded-full border border-border-subtle px-3 py-1 text-[var(--ui-dim)]">
            {task.difficulty}
          </span>
          <span className="rounded-full border border-maturity-mid/40 px-3 py-1 text-maturity-mid">
            {task.provenance}
          </span>
        </div>

        <section aria-labelledby="prompt-heading" className="mt-10">
          <h2 id="prompt-heading" className="text-lg font-bold text-star-bright">
            Prompt
          </h2>
          <p className="mt-3 whitespace-pre-line rounded-xl border border-border-subtle bg-white/[0.02] p-5 text-[14px] leading-relaxed text-star-bright/85">
            {task.prompt}
          </p>
        </section>

        <section aria-labelledby="citations-heading" className="mt-8">
          <h2 id="citations-heading" className="text-lg font-bold text-star-bright">
            Required citations
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {task.required_citations.map((c) => (
              <li
                key={c}
                className="rounded-lg border border-border-subtle bg-white/[0.03] px-3 py-1.5 font-mono text-[12px] text-trajectory"
              >
                {c}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--ui-muted)]">
            Expected answers and the full ground-truth derivation are published
            in the methodology bundle, not on this page; models must not be
            able to look up the answer to a live benchmark task.
          </p>
        </section>

        <section aria-labelledby="responses-heading" className="mt-10 pb-8">
          <h2 id="responses-heading" className="text-lg font-bold text-star-bright">
            Model responses ({runs.length})
          </h2>
          <div className="mt-5 space-y-4">
            {runs.map((run) => (
              <article key={run.id} className="rounded-xl border border-border-subtle bg-white/[0.02] p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-mono text-[13px] text-trajectory">
                    {run.model_provider}:{run.model_version}
                  </h3>
                  <span className="font-mono text-[11px] text-[var(--ui-muted)]">
                    {run.latency_ms}ms · {new Date(run.run_at).toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-[var(--ui-dim)]">
                  <span>
                    numeric:{' '}
                    <span className="tabular-nums text-star-bright/85">
                      {run.numeric_accuracy === null ? 'n/a' : run.numeric_accuracy ? '✓' : '✗'}
                    </span>
                  </span>
                  <span>
                    grounded:{' '}
                    <span className="tabular-nums text-star-bright/85">{Math.round(run.groundedness_score * 100)}%</span>
                  </span>
                  <span>
                    citations:{' '}
                    <span className="tabular-nums text-star-bright/85">{Math.round(run.citation_validity * 100)}%</span>
                  </span>
                  <span>
                    structure:{' '}
                    <span className="tabular-nums text-star-bright/85">{Math.round(run.structure_score * 100)}%</span>
                  </span>
                </div>
                <blockquote className="mt-4 whitespace-pre-line rounded-lg border-l-2 border-trajectory/50 bg-white/[0.03] p-4 text-[13px] leading-relaxed text-star-bright/75">
                  {run.response}
                </blockquote>
                <p className="mt-3 text-[12px] leading-relaxed text-[var(--ui-muted)]">
                  Judge: {run.judge_rationale}
                </p>
              </article>
            ))}
            {runs.length === 0 && (
              <p className="text-[13.5px] text-[var(--ui-dim)]">
                No published runs for this task yet.
              </p>
            )}
          </div>
        </section>

        <Link
          href={`/finbench?track=${track}`}
          prefetch={false}
          className="inline-block rounded-lg border border-border-subtle px-6 py-3 text-[14px] text-[var(--ui-dim)] transition-colors hover:border-trajectory hover:text-star-bright"
        >
          ← Back to the {track} benchmark
        </Link>
      </main>
    );
  }
  notFound();
}
