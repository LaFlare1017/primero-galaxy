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

/**
 * Star breathing: the single source of truth for the organic undulation of
 * the galaxy's stars AND the landing page's legend bubbles, so both animate
 * on the exact same waves. Each star breathes on a sine wave with a per-star
 * phase and frequency offset (instead of pulsing in lockstep):
 *
 *   phase(i)             = (i % phaseMod) * phaseStep
 *   frequency(i, band)   = band.baseFrequency + (i % band.frequencyMod) * band.frequencyStep
 *   coreScale(t, i)      = 1 + core.amplitude * sin(t * frequency(i, core) + phase(i))
 *   haloScale(t, i)      = 1 + halo.amplitude * sin(t * frequency(i, halo) + phase(i) + halo.phaseBias)
 *   haloBrightness(t, i) = halo.brightnessBase + halo.brightnessAmplitude * sin(t * halo.baseFrequency + phase(i) + halo.phaseBias)
 */
export const starBreath = {
  phaseStep: 0.57,
  phaseMod: 11,
  core: {
    amplitude: 0.07,
    baseFrequency: 1.1,
    frequencyStep: 0.12,
    frequencyMod: 7,
  },
  halo: {
    amplitude: 0.16,
    baseFrequency: 1.3,
    frequencyStep: 0.1,
    frequencyMod: 7,
    phaseBias: 1.1,
    brightnessBase: 0.85,
    brightnessAmplitude: 0.15,
  },
} as const;

/** Per-star breathing phase offset (radians). */
export function breathPhase(i: number): number {
  return (i % starBreath.phaseMod) * starBreath.phaseStep;
}

/** Per-star breathing frequency (rad/s) for a core/halo band. */
export function breathFrequency(
  i: number,
  band: { baseFrequency: number; frequencyStep: number; frequencyMod: number }
): number {
  return band.baseFrequency + (i % band.frequencyMod) * band.frequencyStep;
}

/**
 * CSS animation timing (s) that puts a breathing element on star i's halo
 * wave: one full period per cycle, with a negative delay so it sits mid-cycle
 * at first paint, exactly like an already-animating galaxy star.
 */
export function breathTiming(i: number): { duration: number; delay: number } {
  const omega = breathFrequency(i, starBreath.halo);
  const phase = breathPhase(i) + starBreath.halo.phaseBias;
  return { duration: (2 * Math.PI) / omega, delay: -phase / omega };
}

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

export type DimensionKey =
  | 'dataInfrastructure'
  | 'workflowStandardization'
  | 'aiDeployment'
  | 'governance'
  | 'talent';

export interface Dimension {
  key: DimensionKey;
  label: string;
  /**
   * Methodology: what the pillar measures and how its 0-100 score is
   * derived from public AI disclosures (earnings calls, product launches,
   * responsible-AI pages, reported deployments).
   */
  description: string;
}

export const DIMENSIONS: Dimension[] = [
  {
    key: 'dataInfrastructure',
    label: 'Data Infrastructure',
    description:
      'The depth of the data foundation: cloud and data-platform maturity, unified and machine-readable data, and analytics at scale. Scores draw on disclosed cloud migrations, enterprise data platforms, and ML-ready pipelines.',
  },
  {
    key: 'workflowStandardization',
    label: 'Workflow Standardization',
    description:
      'How far core processes (operations, supply chain, customer workflows) are codified and automated rather than run as isolated pilots. Scores draw on disclosed automation programs, digital-twin usage, and process-reengineering initiatives.',
  },
  {
    key: 'aiDeployment',
    label: 'AI Deployment',
    description:
      'The breadth and maturity of production AI: named products and assistants shipped to customers and employees, with disclosed scale such as user counts, seats, or revenue run rates. A named product with measurable adoption is the strongest evidence.',
  },
  {
    key: 'governance',
    label: 'Governance',
    description:
      'Whether the company runs AI under formal governance: published responsible-AI principles, ethics oversight, executive accountability, and documented risk frameworks. Scores draw on public AI-governance pages and regulatory disclosures.',
  },
  {
    key: 'talent',
    label: 'Talent',
    description:
      'Workforce AI capability: disclosed AI hiring, dedicated AI research or engineering orgs, upskilling programs, and executive leadership on AI. Named AI orgs and executive-level accountability score highest.',
  },
];
