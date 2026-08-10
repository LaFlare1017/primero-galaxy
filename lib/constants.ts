// Design tokens from the handoff spec, shared between 3D and UI code.

export const COLORS = {
  void: '#030308',
  nebula: '#0A0A1A',
  starBright: '#FFFFFF',
  starDim: '#4A4A6A',
  maturityLow: '#FF6B35',
  maturityMid: '#F7C548',
  maturityHigh: '#00D9C0',
  trajectory: '#7B61FF',
  uiMuted: '#6B6B8A',
  uiDim: '#B0B0C8',
  borderSubtle: '#1A1A3A',
} as const;

/** Scene scale constants (units). */
export const SCENE = {
  galaxyRadius: 400,
  cameraDistance: 800,
  starBaseRadius: 1.5,
  dustMinRadius: 600,
  dustMaxRadius: 800,
} as const;

/** Zoom thresholds: camera distance at which constellation lines fade in. */
export const ZOOM = {
  constellationFadeStart: 550,
  constellationFull: 260,
  constellationMode: 400,
} as const;

export const COMPANY_COUNT = 500;
export const FEATURED_COUNT = 10;
export const PE_BACKED_COUNT = 50;

/** Maturity color for a 0-100 score (hex). */
export function maturityColor(score: number): string {
  if (score > 70) return COLORS.maturityHigh;
  if (score > 40) return COLORS.maturityMid;
  return COLORS.maturityLow;
}

export function maturityLabel(score: number): string {
  if (score > 70) return 'High';
  if (score > 40) return 'Mid';
  return 'Low';
}

export const DIMENSIONS: { key: 'dataInfrastructure' | 'workflowStandardization' | 'aiDeployment' | 'governance' | 'talent'; label: string }[] = [
  { key: 'dataInfrastructure', label: 'Data Infrastructure' },
  { key: 'workflowStandardization', label: 'Workflow Standardization' },
  { key: 'aiDeployment', label: 'AI Deployment' },
  { key: 'governance', label: 'Governance' },
  { key: 'talent', label: 'Talent' },
];
