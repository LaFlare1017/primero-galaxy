import {
  Company,
  CompanySize,
  ERPSystem,
  Industry,
  MaturityScores,
  Milestone,
  Position3D,
} from '@/types';
import { clamp, mulberry32, round, slugify } from './utils';
import { computeGalaxyLayout } from './galaxy-layout';
import { COMPANY_COUNT, FEATURED_COUNT, PE_BACKED_COUNT } from './constants';

// ---------------------------------------------------------------------------
// Pools & distributions
// ---------------------------------------------------------------------------

const INDUSTRIES: Industry[] = ['Manufacturing', 'Healthcare', 'SaaS', 'Fintech', 'Logistics', 'Retail', 'Energy'];

const INDUSTRY_WEIGHTS: Record<Industry, number> = {
  Manufacturing: 0.2,
  Healthcare: 0.15,
  SaaS: 0.18,
  Fintech: 0.15,
  Logistics: 0.12,
  Retail: 0.1,
  Energy: 0.1,
};

const ERPS: ERPSystem[] = ['NetSuite', 'SAP', 'Oracle', 'Workday', 'Microsoft Dynamics', 'Sage', 'Custom'];

const ERP_WEIGHTS: Record<ERPSystem, number> = {
  NetSuite: 0.55,
  SAP: 0.2,
  Oracle: 0.1,
  Workday: 0.05,
  'Microsoft Dynamics': 0.05,
  Sage: 0.03,
  Custom: 0.02,
};

const SIZES: CompanySize[] = ['<50', '50-200', '200-500', '500-1000', '1000+'];
const SIZE_WEIGHTS: Record<CompanySize, number> = {
  '<50': 0.2,
  '50-200': 0.25,
  '200-500': 0.2,
  '500-1000': 0.15,
  '1000+': 0.2,
};

const NAME_FIRST = [
  'Acme', 'Apex', 'Northwind', 'Helios', 'Meridian', 'Cobalt', 'Vertex', 'Aurora', 'Summit',
  'Ironwood', 'Pacific', 'Beacon', 'Harbor', 'Solstice', 'Nimbus', 'Granite', 'Atlas', 'Zenith',
  'Cascade', 'Orion', 'Pinnacle', 'Vanguard', 'Lumen', 'Fjord', 'Sable', 'Ember', 'Kestrel',
  'Marlin', 'Nova', 'Onyx', 'Praxis', 'Quill', 'Raven', 'Sierra', 'Titan', 'Umbra', 'Vesper',
  'Willow', 'Yarrow', 'Zephyr', 'Crestline', 'Halcyon', 'Magnolia', 'Osprey', 'Redwood', 'Stonegate',
];

const NAME_SECOND = [
  'Industries', 'Group', 'Systems', 'Solutions', 'Dynamics', 'Works', 'Logistics', 'Health',
  'Tech', 'Energy', 'Retail', 'Manufacturing', 'Financial', 'Data', 'Analytics', 'Supply',
  'Robotics', 'Software', 'Materials', 'Automotive', 'Foods', 'Biotech', 'Network', 'Digital',
  'Aerospace', 'Global', 'Partners', 'Holdings', 'Labs', 'Enterprises',
];

const CITIES = [
  'Austin, TX', 'Nashville, TN', 'Denver, CO', 'Chicago, IL', 'Seattle, WA', 'Boston, MA',
  'Atlanta, GA', 'Dallas, TX', 'Phoenix, AZ', 'Charlotte, NC', 'Minneapolis, MN', 'Portland, OR',
  'San Diego, CA', 'Tampa, FL', 'Cleveland, OH', 'Columbus, OH', 'Salt Lake City, UT', 'Raleigh, NC',
  'Kansas City, MO', 'Indianapolis, IN', 'Cincinnati, OH', 'Pittsburgh, PA', 'Milwaukee, WI',
  'Richmond, VA', 'Louisville, KY', 'Oklahoma City, OK', 'Omaha, NE', 'Memphis, TN', 'Detroit, MI',
  'St. Louis, MO', 'Hartford, CT', 'Providence, RI', 'Buffalo, NY', 'Albuquerque, NM', 'Boise, ID',
];

const PE_FIRMS = [
  'Primero Capital', 'Ardent Equity Partners', 'NorthPeak Capital', 'Crestline Partners',
  'Summit Ridge Equity', 'Blackthorn Partners', 'Halcyon Group', 'Ironbridge Capital',
  'Kestrel Equity', 'Onyx Point Capital',
];

const MILESTONE_TEMPLATES: { month: number; title: string; description: string }[] = [
  {
    month: 3,
    title: 'Workflow standardization complete',
    description: 'SOPs unified across the ERP footprint',
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickWeighted<T extends string>(rng: () => number, keys: T[], weights: Record<T, number>): T {
  let r = rng();
  for (const key of keys) {
    r -= weights[key];
    if (r <= 0) return key;
  }
  return keys[keys.length - 1];
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function generateMaturity(rng: () => number): MaturityScores {
  // Distribution: 20% low (0-40), 50% mid (40-70), 30% high (70-100)
  const r = rng();
  let overall: number;
  if (r < 0.2) overall = randInt(rng, 8, 38);
  else if (r < 0.7) overall = randInt(rng, 40, 69);
  else overall = randInt(rng, 71, 98);

  const dim = (offsetMin: number, offsetMax: number) =>
    clamp(overall + randInt(rng, offsetMin, offsetMax), 0, 100);

  return {
    overall,
    dataInfrastructure: dim(-15, 15),
    workflowStandardization: dim(-10, 20),
    aiDeployment: dim(-25, 10),
    governance: dim(-20, 15),
    talent: dim(-15, 20),
  };
}

function generateName(rng: () => number, used: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const name = `${pick(rng, NAME_FIRST)} ${pick(rng, NAME_SECOND)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const name = `${pick(rng, NAME_FIRST)} ${pick(rng, NAME_SECOND)} ${used.size}`;
  used.add(name);
  return name;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function generateCompanies(count: number, seed = 42): Company[] {
  const rng = mulberry32(seed);
  const usedNames = new Set<string>();
  const industryKeys = INDUSTRIES;
  const erpKeys = ERPS;
  const sizeKeys = SIZES;

  const companies: Company[] = Array.from({ length: count }, (_, i) => {
    const industry = pickWeighted(rng, industryKeys, INDUSTRY_WEIGHTS);
    const erpSystem = pickWeighted(rng, erpKeys, ERP_WEIGHTS);
    const maturity = generateMaturity(rng);
    const name = generateName(rng, usedNames);

    return {
      id: `company-${i}`,
      name,
      slug: slugify(name),
      industry,
      erpSystem,
      size: pickWeighted(rng, sizeKeys, SIZE_WEIGHTS),
      maturity,
      position: { x: 0, y: 0, z: 0 }, // filled by the layout algorithm
      constellationId: `${industry}::${erpSystem}`,
      peFirm: undefined,
      founded: randInt(rng, 1980, 2024),
      revenue: round(Math.pow(10, 0.7 + rng() * 2.0), 1), // ~5 - 500 $M, log-distributed
      employees: randInt(rng, 20, 8000),
      location: pick(rng, CITIES),
      isFeatured: false,
      isUserAdded: false,
    };
  });

  // Mark ~10% PE-backed
  const peIndices = new Set<number>();
  while (peIndices.size < PE_BACKED_COUNT) {
    peIndices.add(Math.floor(rng() * count));
  }
  for (const idx of peIndices) {
    companies[idx].peFirm = pick(rng, PE_FIRMS);
  }

  // Mark top-maturity companies as featured
  const byMaturity = [...companies].sort((a, b) => b.maturity.overall - a.maturity.overall);
  for (let i = 0; i < Math.min(FEATURED_COUNT, count); i++) {
    byMaturity[i].isFeatured = true;
  }

  return companies;
}

// ---------------------------------------------------------------------------
// Trajectories (depends on final positions, so it runs after layout)
// ---------------------------------------------------------------------------

function attachTrajectories(companies: Company[], seed = 7): void {
  const rng = mulberry32(seed);

  for (const company of companies) {
    const isBacked = Boolean(company.peFirm);
    const isFeatured = company.isFeatured;
    const wantsTrajectory = rng() < 0.3;

    if (!isBacked && !isFeatured && !wantsTrajectory) continue;

    const targetMaturity = clamp(company.maturity.overall + randInt(rng, 8, 22), 1, 100);

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
      projectedHoldingPeriodReduction: randInt(rng, 3, 18),
    };
  }
}

// ---------------------------------------------------------------------------
// Memoized entry point shared by the page (SSR) and the API route
// ---------------------------------------------------------------------------

let cached: Company[] | null = null;

export function getCompanies(count: number = COMPANY_COUNT): Company[] {
  if (cached) return cached;
  const raw = generateCompanies(count);
  const laidOut = computeGalaxyLayout(raw);
  attachTrajectories(laidOut);
  cached = laidOut;
  return laidOut;
}
