import { Company, Industry, MaturityScores, Milestone, Position3D } from '@/types';
import { clamp, round, slugify } from './utils';

export interface UserCompanyInput {
  name: string;
  industry: Industry;
  /** Current AI status (0-100), which becomes the maturity overall score. */
  aiStatus: number;
}

/**
 * Build a user-added Company that fits the galaxy's conventions:
 *  - position in the outer band, pulled inward by maturity (the layout maps
 *    mature stars toward the core, so a new star follows the same rule)
 *  - maturity dimensions spread deterministically around the slider value
 *    (stable per name, so the radar chart has a real shape)
 *  - always carries a trajectory, so "See your trajectory?" has something to
 *    draw
 */
export function createUserCompany(input: UserCompanyInput): Company {
  const overall = clamp(Math.round(input.aiStatus), 0, 100);

  // Deterministic per-name hash -> stable radar shape for this company
  const h = hash01(input.name.trim().toLowerCase());
  const dim = (offset: number, spread: number) =>
    clamp(Math.round(overall + offset + (h - 0.5) * spread), 2, 100);

  const maturity: MaturityScores = {
    overall,
    dataInfrastructure: dim(2, 26),
    workflowStandardization: dim(6, 22),
    aiDeployment: dim(-4, 18),
    governance: dim(-8, 20),
    talent: dim(-10, 24),
  };

  // Random direction on the unit sphere, radius in the galaxy's outer band.
  // High-maturity stars sit closer to the core (same inward rule as the layout).
  const inward = 1 - (overall / 100) * 0.45;
  const radius = (110 + Math.random() * 200) * inward;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const position: Position3D = {
    x: round(radius * Math.sin(phi) * Math.cos(theta), 2),
    y: round(radius * Math.cos(phi), 2),
    z: round(radius * Math.sin(phi) * Math.sin(theta), 2),
  };

  const revenue = round(5 + Math.random() * 55, 1);
  const trajectory = buildTrajectory(position, overall, revenue, h);

  return {
    id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim(),
    slug: slugify(input.name),
    industry: input.industry,
    size: '<50',
    maturity,
    position,
    constellationId: input.industry,
    founded: 2026,
    revenue,
    employees: 30 + Math.round(overall * 2.2),
    location: 'Your company',
    isFeatured: false,
    isUserAdded: true,
    trajectory,
  };
}

/** Transformation trajectory: drifts the star inward toward the mature core. */
function buildTrajectory(
  position: Position3D,
  overall: number,
  revenue: number,
  h: number
): Company['trajectory'] {
  const targetMaturity = clamp(overall + 10 + Math.round(h * 14), 1, 100);

  const fCurrent = 1 - (overall / 100) * 0.45;
  const fTarget = 1 - (targetMaturity / 100) * 0.45;
  const inward = fTarget / fCurrent;

  const targetPosition: Position3D = {
    x: round(position.x * inward + (h - 0.5) * 8, 2),
    y: round(position.y * inward + (h - 0.5) * 8, 2),
    z: round(position.z * inward + (h - 0.5) * 8, 2),
  };

  const projectedEbitdaImpact = round(revenue * (0.006 + h * 0.014), 1);

  const milestones: Milestone[] = [
    {
      month: 3,
      title: 'Workflow standardization complete',
      description: 'Standard operating procedures unified across business units',
      impact: round(projectedEbitdaImpact * 0.3, 1),
    },
    {
      month: 6,
      title: 'First AI agent deployed',
      description: 'Automated reconciliation in production',
      impact: round(projectedEbitdaImpact * 0.65, 1),
    },
    {
      month: 12,
      title: 'Full cluster deployment',
      description: 'Agents operating across finance and operations',
      impact: round(projectedEbitdaImpact * 1.0, 1),
    },
  ];

  return {
    targetPosition,
    targetMaturity,
    milestones,
    projectedEbitdaImpact,
    projectedMultipleImprovement: round(0.3 + h * 1.2, 1),
    projectedHoldingPeriodReduction: 3 + Math.round(h * 15),
  };
}

/** Deterministic [0, 1) hash of a string (FNV-1a). */
function hash01(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}
