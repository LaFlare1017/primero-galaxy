import { Company, Milestone, Position3D } from '@/types';
import { clamp, mulberry32, round, slugify } from './utils';
import { computeGalaxyLayout } from './galaxy-layout';
import { FORTUNE500_AI_COMPANIES, COMPANY_COUNT, COMPANY_META } from './fortune500-data';

// ---------------------------------------------------------------------------
// The galaxy is no longer simulated: it renders a curated snapshot of ~193
// real Fortune 500 enterprises (lib/fortune500-data.ts) with AI-maturity
// estimates derived from public AI disclosures. This module only maps those
// entries onto the Company model, runs the force-directed layout, and
// attaches transformation trajectories.
// ---------------------------------------------------------------------------

function buildCompanies(count: number): Company[] {
  const companies: Company[] = FORTUNE500_AI_COMPANIES.slice(0, count).map((e, i) => {
    const [overall, dataInfrastructure, workflowStandardization, aiDeployment, governance, talent] = e.m;
    const slug = slugify(e.name);
    const meta = COMPANY_META[e.name];
    return {
      id: `f500-${slug}`,
      name: e.name,
      slug,
      industry: e.industry,
      size: '1000+', // every Fortune 500 enterprise clears the largest band
      maturity: {
        overall,
        dataInfrastructure,
        workflowStandardization,
        aiDeployment,
        governance,
        talent,
      },
      position: { x: 0, y: 0, z: 0 }, // filled by the layout algorithm
      constellationId: e.industry,
      peFirm: undefined, // public companies; no PE backing
      founded: e.founded,
      revenue: e.revenue,
      employees: e.employees,
      location: e.location,
      ticker: meta?.ticker || undefined,
      domain: meta?.domain || undefined,
      aiPositioning: e.note,
      aiSource: e.source,
      dimensionSources: e.dimensionSources,
      isFeatured: Boolean(e.featured),
      isUserAdded: false,
    };
  });

  // Revenue rank within the dataset (1 = largest), a quick orienting stat
  // for the profile header.
  [...companies]
    .sort((a, b) => b.revenue - a.revenue)
    .forEach((c, i) => {
      c.revenueRank = i + 1;
    });

  return companies;
}

// ---------------------------------------------------------------------------
// Trajectories (depends on final positions, so it runs after layout)
// ---------------------------------------------------------------------------

const MILESTONE_TEMPLATES: { month: number; title: string; description: string }[] = [
  {
    month: 3,
    title: 'Workflow standardization complete',
    description: 'Standard operating procedures unified across business units',
  },
  {
    month: 6,
    title: 'First AI agent deployed',
    description: 'Automated reconciliation in production',
  },
  {
    month: 12,
    title: 'Full cluster deployment',
    description: 'Agents operating across finance and operations',
  },
];

function attachTrajectories(companies: Company[], seed = 7): void {
  const rng = mulberry32(seed);

  for (const company of companies) {
    const isFeatured = company.isFeatured;
    const wantsTrajectory = rng() < 0.3;

    if (!isFeatured && !wantsTrajectory) continue;

    const targetMaturity = clamp(company.maturity.overall + Math.round(8 + rng() * 14), 1, 100);

    // Radial inward drift toward the mature core. The layout places higher
    // maturity closer to the center, so transformation moves stars inward.
    const fCurrent = 1 - (company.maturity.overall / 100) * 0.45;
    const fTarget = 1 - (targetMaturity / 100) * 0.45;
    const inward = fTarget / fCurrent;

    const jitter = 10;
    const targetPosition: Position3D = {
      x: round(company.position.x * inward + (rng() - 0.5) * jitter, 2),
      y: round(company.position.y * inward + (rng() - 0.5) * jitter, 2),
      z: round(company.position.z * inward + (rng() - 0.5) * jitter, 2),
    };

    const projectedEbitdaImpact = round(company.revenue * (0.006 + rng() * 0.014), 1);

    const milestones: Milestone[] = MILESTONE_TEMPLATES.map((t, i) => ({
      month: t.month,
      title: t.title,
      description: t.description,
      impact: round(projectedEbitdaImpact * (0.3 + i * 0.35), 1),
    }));

    company.trajectory = {
      targetPosition,
      targetMaturity: Math.round(targetMaturity),
      milestones,
      projectedEbitdaImpact,
      projectedMultipleImprovement: round(0.3 + rng() * 1.2, 1),
      projectedHoldingPeriodReduction: Math.round(3 + rng() * 15),
    };
  }
}

// ---------------------------------------------------------------------------
// Memoized entry point shared by the page (SSR) and the API route
// ---------------------------------------------------------------------------

let cached: Company[] | null = null;

export function getCompanies(count: number = COMPANY_COUNT): Company[] {
  if (cached) return cached;
  const raw = buildCompanies(count);
  const laidOut = computeGalaxyLayout(raw);
  attachTrajectories(laidOut);
  cached = laidOut;
  return laidOut;
}
