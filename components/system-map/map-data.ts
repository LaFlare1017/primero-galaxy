/**
 * Data model for the /system-map isometric architecture map.
 *
 * Every node cites the real file(s) it represents and every edge cites where
 * the import/call actually lives, so the diagram is an inspectable map of the
 * repository rather than a generic illustration. The three layers of the map:
 *
 *   buildings  = modules (one or more source files), extruded by height
 *   edges      = dependencies / control flow between modules
 *   payloads   = the Company[] object traced along the golden path
 *
 * Keep this file free of three.js and React so the data stays portable.
 */

export type LayerId = 'data' | 'compute' | 'server' | 'scene' | 'state' | 'ops';
export type EdgeKind = 'payload' | 'dependency' | 'control';

export interface LayerDef {
  id: LayerId;
  label: string;
  /** Building body color (hex). */
  color: string;
  /** One-line summary shown in the legend. */
  note: string;
}

export interface MapNode {
  id: string;
  /** Short label rendered on the building. */
  name: string;
  /** Primary cited file (the one the label points at). */
  file: string;
  /** Extra files for grouped nodes (scene helpers, UI, fallback, ops). */
  files?: string[];
  layer: LayerId;
  /** One-line role. */
  role: string;
  /** Longer explainer copy for the panel. */
  detail: string;
  /** Grid cell [x, z]; x is the column, z the depth row (0 = back). */
  grid: [number, number];
  /** Building height (extrusion depth), doubles as an importance hint. */
  height: number;
}

export interface MapEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Short annotation drawn on hover in the panel. */
  label: string;
  /** Where the import/call lives (a real file path, optionally :line). */
  cite: string;
  /** `payload` edges animate a moving dot along the arc. */
  trace?: boolean;
}

export const LAYERS: LayerDef[] = [
  { id: 'data', label: 'Data & model', color: '#00D9C0', note: 'curated dataset + shared types/helpers' },
  { id: 'compute', label: 'Compute', color: '#7B61FF', note: 'transforms the payload (layout, trajectories)' },
  { id: 'server', label: 'Server', color: '#F7C548', note: 'request entry points (SSR, API, OG image)' },
  { id: 'scene', label: '3D scene', color: '#FF6B35', note: 'renders the payload as a galaxy' },
  { id: 'state', label: 'State & UI', color: '#B0B0C8', note: 'interactive state + controls' },
  { id: 'ops', label: 'Build & CI', color: '#6B6B8A', note: 'config, tests, Lighthouse gate' },
];

export const NODES: MapNode[] = [
  // ── Data & model (back row) ────────────────────────────────────────────────
  {
    id: 'fortune500-data',
    name: 'fortune500-data',
    file: 'lib/fortune500-data.ts',
    layer: 'data',
    role: 'Curated Fortune 500 dataset',
    detail:
      '~193 real Fortune 500 enterprises, each scored 0–100 on five AI-maturity dimensions with public positioning notes, per-dimension evidence URLs, tickers, domains, and sector medians. Exports FORTUNE500_AI_COMPANIES, COMPANY_COUNT, COMPANY_META, SECTOR_MEDIAN.',
    grid: [0, 0],
    height: 8,
  },
  {
    id: 'types',
    name: 'types',
    file: 'types/index.ts',
    layer: 'data',
    role: 'Shared data-model interfaces',
    detail:
      'Company, MaturityScores (five dimensions + overall), Trajectory, ConstellationLink, and the Industry taxonomy. The single schema every layer builds against.',
    grid: [1, 0],
    height: 2,
  },
  {
    id: 'constants',
    name: 'constants',
    file: 'lib/constants.ts',
    layer: 'data',
    role: 'Design tokens + methodology',
    detail:
      'COLORS, SCENE/ZOOM constants, the five DIMENSIONS with pillar descriptions, maturityColor/maturityLabel, and the starBreath wave (the shared breathing phase/frequency used by both the galaxy and the landing legend).',
    grid: [2, 0],
    height: 3,
  },
  {
    id: 'utils',
    name: 'utils',
    file: 'lib/utils.ts',
    layer: 'data',
    role: 'Pure helpers',
    detail:
      'slugify, mulberry32 (seeded PRNG), clamp/smoothstep/lerp/round, formatRevenue, and logoUrl/monogram (favicon service + local logo fallback). No React, no I/O.',
    grid: [3, 0],
    height: 2,
  },

  // ── Compute (row 1) ────────────────────────────────────────────────────────
  {
    id: 'galaxy-layout',
    name: 'galaxy-layout',
    file: 'lib/galaxy-layout.ts',
    layer: 'compute',
    role: 'Force-directed 3D layout',
    detail:
      'computeGalaxyLayout() runs a d3-force-3d simulation (300 ticks, mulberry32 seed) to place every star in the galaxy sphere, pulling high-maturity companies toward the core. Also builds the constellation edge set (computeConstellationLinks).',
    grid: [0, 1],
    height: 5,
  },
  {
    id: 'data-generator',
    name: 'data-generator',
    file: 'lib/data-generator.ts',
    layer: 'compute',
    role: 'Payload assembly (memoized)',
    detail:
      'getCompanies(): maps dataset entries onto the Company model, runs the layout, attaches transformation trajectories, then memoizes the result so the SSR page and the API route share one deterministic galaxy.',
    grid: [1, 1],
    height: 4,
  },
  {
    id: 'user-company',
    name: 'user-company',
    file: 'lib/user-company.ts',
    layer: 'compute',
    role: 'User-added star builder',
    detail:
      'createUserCompany() turns the Add Company form input into a valid Company: deterministic radar shape (FNV-1a hash), an outer-band position pulled inward by maturity, and an always-present trajectory.',
    grid: [2, 1],
    height: 3,
  },

  // ── Server (row 2) ─────────────────────────────────────────────────────────
  {
    id: 'galaxy-page',
    name: 'galaxy/page',
    file: 'app/galaxy/page.tsx',
    layer: 'server',
    role: 'SSR entry for /galaxy',
    detail:
      'Server component that calls getCompanies(COMPANY_COUNT) and hands the Company[] to <GalaxyApp companies>. Also owns the /galaxy metadata (canonical, OG, twitter).',
    grid: [0, 2],
    height: 3,
  },
  {
    id: 'api-companies',
    name: 'api/companies',
    file: 'app/api/companies/route.ts',
    layer: 'server',
    role: 'GET /api/companies',
    detail:
      'Returns the pre-computed galaxy as JSON (force-dynamic). Shares the same memoized getCompanies() cache as the page, so both surfaces serve the identical dataset.',
    grid: [1, 2],
    height: 2,
  },
  {
    id: 'og',
    name: 'og',
    file: 'app/og/route.tsx',
    layer: 'server',
    role: 'Social-share image',
    detail:
      'Edge route rendering the 1200×630 share PNG with next/og ImageResponse, from the same design tokens. A route handler (not the file convention) so the og:image URL stays query-string-free for unfurl crawlers.',
    grid: [2, 2],
    height: 2,
  },

  // ── 3D scene (row 3) ───────────────────────────────────────────────────────
  {
    id: 'galaxy-app',
    name: 'GalaxyApp',
    file: 'components/galaxy/GalaxyApp.tsx',
    layer: 'scene',
    role: 'Client orchestrator',
    detail:
      'Owns the page shell: dynamic-imports the scene (ssr:false), probes WebGL, hydrates user stars + pending toasts, wires the Esc key, and renders every overlay (title, panel, toasts, bottom bar, search, add form).',
    grid: [0, 3],
    height: 5,
  },
  {
    id: 'galaxy-scene',
    name: 'GalaxyScene',
    file: 'components/galaxy/GalaxyScene.tsx',
    layer: 'scene',
    role: 'R3F canvas root',
    detail:
      'The @react-three/fiber <Canvas> with the orthographic-to-perspective camera, post-processing (UnrealBloom + ACES), and the galaxy group (stars, constellations, labels, dust, camera rig).',
    grid: [1, 3],
    height: 5,
  },
  {
    id: 'starfield',
    name: 'StarField',
    file: 'components/galaxy/StarField.tsx',
    layer: 'scene',
    role: 'Instanced star mesh',
    detail:
      'All ~193 data stars in a single InstancedMesh draw call plus a billboarded halo InstancedMesh. Per-frame: breathing scale, maturity colors, hover/selection scale, focus dimming, and the raycast-driven hover/double-click handlers.',
    grid: [2, 3],
    height: 6,
  },
  {
    id: 'scene-helpers',
    name: 'scene modules',
    file: 'components/galaxy/ConstellationLines.tsx',
    files: [
      'components/galaxy/ConstellationLines.tsx',
      'components/galaxy/StarLabels.tsx',
      'components/galaxy/DustParticles.tsx',
      'components/galaxy/PlanetSystem.tsx',
      'components/galaxy/TrajectoryPath.tsx',
      'components/galaxy/CameraRig.tsx',
      'components/galaxy/PostProcessing.tsx',
    ],
    layer: 'scene',
    role: 'Constellations, labels, dust, planet view, flight',
    detail:
      'The supporting scene pieces: constellation lines (fade in on zoom), text labels, dust particles, the planet-view system + trajectory arc for a selected star, camera flight, and the bloom/tone-mapping pass.',
    grid: [3, 3],
    height: 4,
  },

  // ── State & UI (row 4) ─────────────────────────────────────────────────────
  {
    id: 'galaxy-store',
    name: 'galaxyStore',
    file: 'store/galaxyStore.ts',
    layer: 'state',
    role: 'Zustand store + persistence',
    detail:
      'The single source of truth for mode, selected/hovered star, camera target, zoom, trajectory toggle, user stars, and the toast stack. Persists user stars to localStorage and pending toasts to sessionStorage with stale-toast pruning on hydration.',
    grid: [0, 4],
    height: 6,
  },
  {
    id: 'ui',
    name: 'UI',
    file: 'components/ui/BottomBar.tsx',
    files: [
      'components/ui/BottomBar.tsx',
      'components/ui/PlanetPanel.tsx',
      'components/ui/RadarChart.tsx',
      'components/ui/CompanySearch.tsx',
      'components/ui/AddCompanyForm.tsx',
      'components/ui/Tooltip.tsx',
      'components/ui/ToastStack.tsx',
      'components/ui/CompanyLogo.tsx',
    ],
    layer: 'state',
    role: 'Controls & panels',
    detail:
      'The DOM surface: bottom bar, planet profile panel with the radar chart, search palette, add-company form, hover tooltip, and the toast stack with Undo. All subscribe to the store; none own state.',
    grid: [1, 4],
    height: 4,
  },
  {
    id: 'fallback',
    name: 'fallback',
    file: 'components/galaxy/WebGLFallback.tsx',
    files: [
      'components/galaxy/WebGLFallback.tsx',
      'components/galaxy/GalaxyErrorBoundary.tsx',
    ],
    layer: 'state',
    role: 'Graceful degradation',
    detail:
      'canUseWebGL() probe + the WebGLFallback panel (full methodology + research trail without the 3D view) and the GalaxyErrorBoundary, so a missing/unsupported WebGL context degrades instead of crashing.',
    grid: [2, 4],
    height: 2,
  },

  // ── Build & CI (row 5) ─────────────────────────────────────────────────────
  {
    id: 'config',
    name: 'config',
    file: 'next.config.js',
    files: ['next.config.js', 'tailwind.config.js', 'playwright.config.ts'],
    layer: 'ops',
    role: 'Build & runtime config',
    detail:
      'next.config.js isolates the e2e build to .next-e2e via NEXT_E2E_DIST_DIR and whitelists the favicon domain; tailwind.config.js holds the design tokens; playwright.config.ts runs e2e against a production build on 3100.',
    grid: [0, 5],
    height: 2,
  },
  {
    id: 'ci',
    name: 'ci',
    file: '.github/workflows/ci.yml',
    files: ['.github/workflows/ci.yml', 'scripts/lighthouse-gate.mjs'],
    layer: 'ops',
    role: 'Lint, typecheck, build, e2e, Lighthouse',
    detail:
      'Three CI jobs on every push/PR: lint + typecheck + build; the Playwright e2e suite; and a Lighthouse gate that fails if a11y/SEO drop below 100/100 on both / and /galaxy.',
    grid: [1, 5],
    height: 3,
  },
];

export const EDGES: MapEdge[] = [
  // ── Golden path: the Company[] payload's journey (animated) ────────────────
  {
    from: 'fortune500-data',
    to: 'data-generator',
    kind: 'payload',
    label: 'FORTUNE500_AI_COMPANIES → Company[]',
    cite: 'lib/data-generator.ts:4',
    trace: true,
  },
  {
    from: 'data-generator',
    to: 'galaxy-page',
    kind: 'payload',
    label: 'getCompanies() → laid-out Company[]',
    cite: 'app/galaxy/page.tsx',
    trace: true,
  },
  {
    from: 'galaxy-page',
    to: 'galaxy-app',
    kind: 'payload',
    label: 'companies prop',
    cite: 'app/galaxy/page.tsx',
    trace: true,
  },
  {
    from: 'galaxy-app',
    to: 'galaxy-scene',
    kind: 'payload',
    label: 'dynamic import + companies',
    cite: 'components/galaxy/GalaxyApp.tsx',
    trace: true,
  },
  {
    from: 'galaxy-scene',
    to: 'starfield',
    kind: 'payload',
    label: 'companies → InstancedMesh',
    cite: 'components/galaxy/GalaxyScene.tsx',
    trace: true,
  },
  {
    from: 'data-generator',
    to: 'api-companies',
    kind: 'payload',
    label: 'getCompanies() → JSON',
    cite: 'app/api/companies/route.ts',
    trace: true,
  },

  // ── Dependencies (imports) ────────────────────────────────────────────────
  {
    from: 'data-generator',
    to: 'galaxy-layout',
    kind: 'dependency',
    label: 'computeGalaxyLayout()',
    cite: 'lib/data-generator.ts',
  },
  {
    from: 'data-generator',
    to: 'types',
    kind: 'dependency',
    label: 'Company, Milestone',
    cite: 'lib/data-generator.ts:1',
  },
  {
    from: 'galaxy-layout',
    to: 'utils',
    kind: 'dependency',
    label: 'mulberry32, round',
    cite: 'lib/galaxy-layout.ts:11',
  },
  {
    from: 'starfield',
    to: 'constants',
    kind: 'dependency',
    label: 'maturityColor, starBreath',
    cite: 'components/galaxy/StarField.tsx:8',
  },
  {
    from: 'types',
    to: 'constants',
    kind: 'dependency',
    label: 'DimensionKey',
    cite: 'types/index.ts:3',
  },

  // ── Control flow (events + state) ─────────────────────────────────────────
  {
    from: 'starfield',
    to: 'galaxy-store',
    kind: 'control',
    label: 'hoverStar / selectStar',
    cite: 'components/galaxy/StarField.tsx',
  },
  {
    from: 'galaxy-app',
    to: 'galaxy-store',
    kind: 'control',
    label: 'hydrateUserStars / hydratePendingToasts',
    cite: 'components/galaxy/GalaxyApp.tsx',
  },
  {
    from: 'galaxy-store',
    to: 'ui',
    kind: 'control',
    label: 'subscribe: selectedStar, mode, toasts',
    cite: 'components/ui/PlanetPanel.tsx',
  },
  {
    from: 'ui',
    to: 'user-company',
    kind: 'control',
    label: 'createUserCompany()',
    cite: 'components/ui/AddCompanyForm.tsx',
  },
  {
    from: 'galaxy-app',
    to: 'fallback',
    kind: 'control',
    label: 'canUseWebGL()',
    cite: 'components/galaxy/GalaxyApp.tsx',
  },
];

export const NODE_BY_ID: Record<string, MapNode> = Object.fromEntries(
  NODES.map((n) => [n.id, n])
);

/** The main payload path (dataset → mesh), rendered as the explainer breadcrumb. */
export const GOLDEN_PATH: string[] = [
  'fortune500-data',
  'data-generator',
  'galaxy-page',
  'galaxy-app',
  'galaxy-scene',
  'starfield',
];

export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<
  LayerId,
  LayerDef
>;
