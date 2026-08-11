import Link from 'next/link';
import type { Metadata } from 'next';
import {
  COLORS,
  DIMENSIONS,
  maturityColor,
  maturityLabel,
} from '@/lib/constants';
import {
  COMPANY_COUNT,
  FORTUNE500_AI_COMPANIES,
} from '@/lib/fortune500-data';
import type { DimensionKey } from '@/lib/constants';
import type { Industry } from '@/types';

export const metadata: Metadata = {
  title: 'Methodology: How the AI Transformation Galaxy is Scored | Primero Galaxy',
  description:
    'The five maturity pillars, the 0-100 scoring rubric, and the full research trail: every Fortune 500 company with the public source behind each score.',
  alternates: { canonical: '/methodology' },
};

const EYEBROW = 'text-[11px] font-semibold uppercase tracking-label text-trajectory';
const SECTION_TITLE = 'text-3xl font-semibold tracking-title text-star-bright md:text-4xl';

/** Short pillar labels for the source trail column. */
const PILLAR_SHORT: Record<string, string> = {
  dataInfrastructure: 'Data',
  workflowStandardization: 'Workflow',
  aiDeployment: 'AI',
  governance: 'Governance',
  talent: 'Talent',
};

/** Human-readable host for a source URL (link text stays compact). */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Group the dataset by industry, preserving first-appearance order. */
function groupByIndustry() {
  const groups: { industry: Industry; companies: typeof FORTUNE500_AI_COMPANIES }[] = [];
  const index = new Map<Industry, number>();
  for (const c of FORTUNE500_AI_COMPANIES) {
    let i = index.get(c.industry);
    if (i === undefined) {
      i = groups.length;
      index.set(c.industry, i);
      groups.push({ industry: c.industry, companies: [] });
    }
    groups[i].companies.push(c);
  }
  return groups;
}

const INDUSTRY_GROUPS = groupByIndustry();

export default function MethodologyPage() {
  return (
    <main className="min-h-[100dvh] bg-void">
      <div className="mx-auto max-w-6xl px-6 pb-24">
        {/* ----------------------------------------------------------------- Nav */}
        <header className="flex h-14 items-center justify-between border-b border-border-subtle/60">
          <Link
            href="/"
            prefetch={false}
            className="text-[13px] font-semibold tracking-[0.18em] text-star-bright transition-colors hover:text-trajectory"
          >
            PRIMERO GALAXY
          </Link>
          <nav aria-label="Primary">
            <Link
              href="/galaxy"
              prefetch={false}
              className="rounded-md border border-maturity-high/50 px-3 py-1.5 text-[12px] font-medium text-maturity-high transition hover:bg-maturity-high/10 active:scale-[0.98]"
            >
              Enter the galaxy →
            </Link>
          </nav>
        </header>

        {/* ----------------------------------------------------------------- Hero */}
        <section className="border-b border-border-subtle/60 py-16 md:py-20">
          <p className={EYEBROW}>Methodology</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-title text-star-bright md:text-5xl">
            How the galaxy is scored.
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ui-dim md:text-base">
            Every star in the {COMPANY_COUNT}-company galaxy carries a 0-100 AI
            transformation maturity estimate. The number is a weighted judgment
            of five pillars, and each pillar is anchored to public evidence:
            earnings-call commentary, product launches, reported deployments,
            and responsible-AI pages. Nothing is scored from unverifiable or
            proprietary data.
          </p>
          <div className="mt-8 rounded-xl border border-border-subtle bg-nebula/40 p-5">
            <h2 className="text-[13px] font-medium text-ui-dim">Scope and use</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-ui-muted">
              Directional research estimates synthesized from public AI
              disclosures as of August 2026. Scores are not audited metrics,
              not investment advice, and not endorsements. Revenue figures and
              headcounts are approximate recent public numbers. Fortune 500
              membership follows the most recent published list; a handful of
              names entered only recently.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------- The pillars */}
        <section className="border-b border-border-subtle/60 py-16">
          <p className={EYEBROW}>The five pillars</p>
          <h2 className={`${SECTION_TITLE} mt-3`}>What each score measures.</h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ui-dim">
            The overall score is a weighted judgment of these five dimensions,
            not a strict average. Each pillar&apos;s score is derived from the
            public disclosures listed under that company in the research trail
            below.
          </p>
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            {DIMENSIONS.map((d, i) => (
              <div
                key={d.key}
                className="rounded-xl border border-border-subtle bg-void/60 p-5"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-subtle text-[11px] font-medium text-ui-muted"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-[13px] font-semibold text-star-bright">
                      {d.label}
                    </h3>
                    <p className="mt-1 text-[12px] leading-relaxed text-ui-muted">
                      {d.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* --------------------------------------------------------- The rubric */}
        <section className="border-b border-border-subtle/60 py-16">
          <p className={EYEBROW}>Scoring rubric</p>
          <h2 className={`${SECTION_TITLE} mt-3`}>Three bands, one color story.</h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ui-dim">
            Each score maps to a color band shared by the galaxy&apos;s stars,
            the planet radar, and the landing-page legend. The bands are the
            same thresholds used everywhere in the product.
          </p>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {[
              {
                range: 'Low · 0-40',
                color: COLORS.maturityLow,
                body: 'Early AI adoption: data scattered, workflows manual, pilots isolated.',
              },
              {
                range: 'Mid · 40-70',
                color: COLORS.maturityMid,
                body: 'Standardizing workflows, first AI use cases in production with measurable scale.',
              },
              {
                range: 'High · 70-100',
                color: COLORS.maturityHigh,
                body: 'Scaled AI deployment, governance in place, named products with disclosed adoption.',
              },
            ].map((b) => (
              <div
                key={b.range}
                className="rounded-xl border border-border-subtle bg-void/60 p-5"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: b.color }}
                  />
                  <h3 className="text-[13px] font-semibold text-star-bright">{b.range}</h3>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-ui-muted">{b.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border-subtle bg-nebula/40 p-5">
              <h3 className="text-[13px] font-medium text-ui-dim">Sector medians</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-ui-muted">
                Every planet profile compares each pillar against its
                industry&apos;s median, computed from this same dataset
                (SECTOR_MEDIAN). A bar above the dashed line outperforms the
                sector; below it, lags.
              </p>
            </div>
            <div className="rounded-xl border border-border-subtle bg-nebula/40 p-5">
              <h3 className="text-[13px] font-medium text-ui-dim">Weighting</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-ui-muted">
                AI Deployment and Data Infrastructure carry the most weight in
                the overall judgment; Governance and Talent act as the
                durability multipliers. Exact weights are intentionally not
                published as fixed numbers: the overall is an analyst-style
                judgment, not a mechanical formula.
              </p>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- Research trail */}
        <section className="pt-16">
          <p className={EYEBROW}>The research trail</p>
          <h2 className={`${SECTION_TITLE} mt-3`}>
            Every company, every source.
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ui-dim">
            One row per company, grouped by industry. The evidence link anchors
            the positioning note; where a pillar has its own researched source,
            it is listed next to it. Hover a link to see the full URL.
          </p>

          {INDUSTRY_GROUPS.map(({ industry, companies }) => (
            <div key={industry} className="mt-12">
              <div className="flex items-baseline gap-3">
                <h3 className="text-[16px] font-semibold tracking-title text-star-bright">
                  {industry}
                </h3>
                <span className="text-[11px] text-ui-muted">
                  {companies.length} companies
                </span>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <caption className="sr-only">
                    {industry} companies with their AI maturity scores and
                    source URLs.
                  </caption>
                  <thead>
                    <tr className="border-b border-border-subtle text-[10px] uppercase tracking-label text-ui-muted">
                      <th scope="col" className="py-2.5 pr-4 font-medium">
                        Company
                      </th>
                      <th scope="col" className="py-2.5 pr-4 font-medium">
                        Score
                      </th>
                      <th scope="col" className="py-2.5 pr-4 font-medium">
                        Positioning note
                      </th>
                      <th scope="col" className="py-2.5 font-medium">
                        Sources
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((c) => {
                      const overall = c.m[0];
                      const dimSources = c.dimensionSources ?? {};
                      const dimKeys = Object.keys(dimSources) as DimensionKey[];
                      return (
                        <tr
                          key={c.name}
                          className="border-b border-border-subtle/50 align-top"
                        >
                          <td className="py-3 pr-4">
                            <div className="text-[13px] font-medium text-star-bright">
                              {c.name}
                            </div>
                            <div className="mt-0.5 text-[10px] text-ui-muted">
                              {c.location}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: maturityColor(overall) }}
                              />
                              <span className="text-[13px] font-medium text-star-bright">
                                {overall}
                              </span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-ui-muted">
                              {maturityLabel(overall)} maturity
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <p className="max-w-md text-[11px] leading-relaxed text-ui-muted">
                              {c.note}
                            </p>
                          </td>
                          <td className="py-3">
                            <a
                              href={c.source}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={c.source}
                              className="text-[11px] font-medium text-trajectory transition-colors hover:text-star-bright"
                            >
                              Evidence ↗
                            </a>
                            {dimKeys.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5">
                                {dimKeys.map((k) => (
                                  <li key={k}>
                                    <a
                                      href={dimSources[k]}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={dimSources[k]}
                                      className="text-[10px] text-ui-muted transition-colors hover:text-star-bright"
                                    >
                                      {PILLAR_SHORT[k]} · {hostOf(dimSources[k]!)} ↗
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>

        {/* -------------------------------------------------------- Closing */}
        <section className="mt-20 border-t border-border-subtle/60 pt-10">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div>
              <h2 className="text-[15px] font-semibold text-star-bright">
                See the scores in motion.
              </h2>
              <p className="mt-1 text-[12px] text-ui-muted">
                {COMPANY_COUNT} companies · 12 industries · AI maturity estimates
              </p>
            </div>
            <Link
              href="/galaxy"
              prefetch={false}
              className="rounded-md bg-maturity-high px-6 py-3 text-sm font-semibold text-void transition hover:opacity-90 active:scale-[0.98]"
            >
              Enter the galaxy
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
