import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'FinBench Methodology',
  description:
    'Task authorship, ground-truth process, scoring dimensions, citation validation, and reproducibility instructions for the FinBench AI accounting benchmark.',
  alternates: { canonical: '/finbench/methodology' },
};

const INVARIANTS: { id: string; title: string; body: string }[] = [
  {
    id: 'INV-1',
    title: 'Original task authorship',
    body: 'Every task is written from scratch or derived only from public, unambiguously-licensed regulatory text. Each task file carries a provenance field; no third-party benchmark content is copied.',
  },
  {
    id: 'INV-2',
    title: 'Model-agnostic, version-pinned',
    body: 'Every run records the exact model identifier (for example claude-sonnet-4-6-20250514, never "Claude"). A model version is immutable once written.',
  },
  {
    id: 'INV-3',
    title: 'No model computes the ground truth',
    body: 'Expected answers are computed independently, by a human expert or a deterministic calculator script, before any model sees the task.',
  },
  {
    id: 'INV-4',
    title: 'Grounded judging, not vibes',
    body: 'Free-text scoring is checked against a static citation lookup table of actual ASC 606 and FAR section identifiers, not a judge model\'s memory. A seeded human spot-check sample is generated for every run.',
  },
  {
    id: 'INV-5',
    title: 'Immutable historical runs',
    body: 'Published monthly results are never edited in place. Corrections are appended as new records that reference the superseded record, preserving trend integrity.',
  },
  {
    id: 'INV-6',
    title: 'No unfalsifiable claims',
    body: 'No aggregate score is published without the task set, rubric, and scoring code available for scrutiny. Every number on the overview page links to the task and run records behind it.',
  },
];

const SCORING: { name: string; body: string }[] = [
  {
    name: 'Numeric accuracy',
    body: 'Exact Decimal match against the independently computed ground truth. Binary, and the headline metric: it is immune to grading-on-a-curve.',
  },
  {
    name: 'Groundedness',
    body: 'Every factual claim must be traceable to the provided task prompt and fixtures.',
  },
  {
    name: 'Citation validity',
    body: 'Cited regulatory sections are checked against a static lookup of real ASC 606 / FAR section identifiers.',
  },
  {
    name: 'Exception calibration',
    body: 'The response flags issues it should flag and does not flag issues it should not. Both directions matter equally. Reported as n/a in the current deterministic baseline.',
  },
  {
    name: 'Structure',
    body: 'Output format matches what a reviewing accountant or contracts officer would expect.',
  },
];

export default function FinbenchMethodologyPage() {
  return (
    <main className="mx-auto min-h-[100svh] max-w-3xl bg-void px-6 py-16">
      <p className="font-mono text-[12px] tracking-[0.14em] text-trajectory">
        FINBENCH · METHODOLOGY
      </p>
      <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.03em] text-star-bright md:text-5xl">
        Inspect everything.
      </h1>
      <p className="mt-5 max-w-[58ch] text-[15.5px] leading-relaxed text-star-bright/70">
        FinBench is a repeatable monthly benchmark of frontier AI models on
        accounting and compliance knowledge work, with two separately scored
        tracks: ASC 606 revenue recognition, and govcon/DCAA compliance. The
        deliverable is publishable findings, never a bare leaderboard number.
      </p>

      <section aria-labelledby="invariants-heading" className="mt-12">
        <h2 id="invariants-heading" className="text-xl font-bold text-star-bright">
          Non-negotiable invariants
        </h2>
        <div className="mt-6 space-y-4">
          {INVARIANTS.map((inv) => (
            <div key={inv.id} className="rounded-xl border border-border-subtle bg-white/[0.02] p-5">
              <p className="font-mono text-[11px] tracking-[0.12em] text-trajectory">{inv.id}</p>
              <h3 className="mt-1.5 text-[15px] font-bold text-star-bright">{inv.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ui-dim)]">{inv.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="scoring-heading" className="mt-12">
        <h2 id="scoring-heading" className="text-xl font-bold text-star-bright">
          Scoring dimensions
        </h2>
        <dl className="mt-6 space-y-4">
          {SCORING.map((s) => (
            <div key={s.name} className="grid grid-cols-[170px_1fr] gap-4 border-b border-border-subtle/70 pb-4 max-sm:grid-cols-1 max-sm:gap-1">
              <dt className="text-[14px] font-semibold text-star-bright">{s.name}</dt>
              <dd className="text-[13.5px] leading-relaxed text-[var(--ui-dim)]">{s.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="repro-heading" className="mt-12">
        <h2 id="repro-heading" className="text-xl font-bold text-star-bright">
          Reproduce a run
        </h2>
        <p className="mt-3 max-w-[58ch] text-[13.5px] leading-relaxed text-[var(--ui-dim)]">
          The entire harness (task YAML, rubrics, deterministic calculators,
          judge, and scoring code) ships in the repository under{' '}
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-star-bright/85">finbench/</code>.
        </p>
        <div className="mt-5 rounded-xl border border-dashed border-border-subtle p-5 font-mono text-[12.5px] leading-relaxed text-[var(--ui-dim)]">
          <div># validate tasks + model roster</div>
          <div>PYTHONPATH=. python3 -m finbench.cli validate --track asc606</div>
          <div className="mt-3"># run a monthly benchmark</div>
          <div>PYTHONPATH=. python3 -m finbench.cli run --track asc606 --month 2026-12</div>
          <div className="mt-3"># publish the web snapshot</div>
          <div>PYTHONPATH=. python3 -m finbench.cli export-web --track asc606 \</div>
          <div className="pl-4">--month 2026-12 --out public/finbench/asc606.json</div>
        </div>
      </section>

      <section aria-labelledby="limits-heading" className="mt-12 pb-8">
        <h2 id="limits-heading" className="text-xl font-bold text-star-bright">
          Known limits
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-[13.5px] leading-relaxed text-[var(--ui-dim)]">
          <li>The current published runs use an offline mock provider; frontier-model results require enabling the credential-gated API adapters in the roster.</li>
          <li>Ground truth is authored by one expert. Independent CPA/DCAA review sign-off is planned before licensing-scale publication.</li>
          <li>Judge agreement rate is tracked from human spot-checks; early months will have small samples and wide uncertainty.</li>
        </ul>
        <Link
          href="/finbench"
          prefetch={false}
          className="mt-10 inline-block rounded-lg border border-border-subtle px-6 py-3 text-[14px] text-[var(--ui-dim)] transition-colors hover:border-trajectory hover:text-star-bright"
        >
          ← Back to the benchmark
        </Link>
      </section>
    </main>
  );
}
