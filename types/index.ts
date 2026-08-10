// Full TypeScript interfaces for the Primero Galaxy data model.

export type Industry =
  | 'Manufacturing'
  | 'Healthcare'
  | 'SaaS'
  | 'Fintech'
  | 'Logistics'
  | 'Retail'
  | 'Energy';

export type ERPSystem =
  | 'NetSuite'
  | 'SAP'
  | 'Oracle'
  | 'Workday'
  | 'Microsoft Dynamics'
  | 'Sage'
  | 'Custom';

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
  erpSystem: ERPSystem;
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

  // Flags
  isFeatured: boolean; // Highlighted in galaxy
  isUserAdded: boolean; // Added via "Add Your Company"
}

export type GalaxyMode = 'galaxy' | 'constellation' | 'planet';

export interface ConstellationLink {
  source: number;
  target: number;
}
