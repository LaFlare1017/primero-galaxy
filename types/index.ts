// Full TypeScript interfaces for the Primero Galaxy data model.

export type Industry =
  | 'Technology'
  | 'Financial Services'
  | 'Insurance'
  | 'Healthcare'
  | 'Retail'
  | 'Consumer Goods'
  | 'Automotive'
  | 'Aerospace & Defense'
  | 'Energy & Utilities'
  | 'Industrial & Manufacturing'
  | 'Transportation & Logistics'
  | 'Telecom & Media';

/** The industry taxonomy as an ordered list (form dropdowns, counts). */
export const INDUSTRIES: Industry[] = [
  'Technology',
  'Financial Services',
  'Insurance',
  'Healthcare',
  'Retail',
  'Consumer Goods',
  'Automotive',
  'Aerospace & Defense',
  'Energy & Utilities',
  'Industrial & Manufacturing',
  'Transportation & Logistics',
  'Telecom & Media',
];

export type CompanySize = '<50' | '50-200' | '200-500' | '500-1000' | '1000+';

export interface MaturityScores {
  overall: number; // Weighted average (0-100)
  dataInfrastructure: number; // Data quality, pipelines, accessibility
  workflowStandardization: number; // SOPs, consistency, documentation
  aiDeployment: number; // Live AI use cases, scale
  governance: number; // ISO 42001, policies, ethics
  talent: number; // AI/ML team size, skills
}

export type MaturityDimension = keyof Omit<MaturityScores, 'overall'>;

export interface Position3D {
  x: number;
  y: number;
  z: number;
}

export interface Milestone {
  month: number; // 1-36
  title: string;
  description: string;
  impact: number; // EBITDA impact at this milestone ($M)
}

export interface Trajectory {
  targetPosition: Position3D;
  targetMaturity: number;
  milestones: Milestone[];
  projectedEbitdaImpact: number; // $M annualized
  projectedMultipleImprovement: number; // x
  projectedHoldingPeriodReduction: number; // months
}

export interface Company {
  id: string; // UUID
  name: string;
  slug: string;
  industry: Industry;
  size: CompanySize;

  maturity: MaturityScores;

  // Position in galaxy (pre-computed via force-directed layout)
  position: Position3D;

  // Constellation grouping
  constellationId: string; // Group ID for related companies
  peFirm?: string; // If PE-backed

  // Trajectory (if applicable)
  trajectory?: Trajectory;

  // Metadata
  founded: number; // Year
  revenue: number; // Annual revenue (USD, millions)
  employees: number;
  location: string;
  /** Stock ticker (e.g. "NVDA"); dataset stars only. */
  ticker?: string;
  /** Company website domain (logo fetch + profile link); dataset stars only. */
  domain?: string;
  /** Rank by revenue within the dataset (1 = largest); dataset stars only. */
  revenueRank?: number;

  /**
   * Public AI positioning: a one-line research note on what the company has
   * actually said or done about AI (earnings-call commentary, product
   * launches, reported deployments). For the curated Fortune 500 dataset
   * these are compiled from public disclosures; for user-added stars it is
   * omitted.
   */
  aiPositioning?: string;

  // Flags
  isFeatured: boolean; // Highlighted in galaxy
  isUserAdded: boolean; // Added via "Add Your Company"
}

export type GalaxyMode = 'galaxy' | 'constellation' | 'planet';

export interface ConstellationLink {
  source: number;
  target: number;
}
