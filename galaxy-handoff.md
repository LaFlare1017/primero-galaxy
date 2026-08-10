# PRIMERO GALAXY
## Complete Build Specification
### AI Transformation Maturity Galaxy — Awwwards-Level 3D Experience
### Version 1.0 | August 2026

---

## TABLE OF CONTENTS

1. [Creative Vision](#1-creative-vision)
2. [Visual Design System](#2-visual-design-system)
3. [3D Aesthetic Specification](#3-3d-aesthetic-specification)
4. [Scene Architecture](#4-scene-architecture)
5. [User Journeys & Flows](#5-user-journeys--flows)
6. [Component Library](#6-component-library)
7. [Data Model](#7-data-model)
8. [Animation & Motion](#8-animation--motion)
9. [Technical Stack](#9-technical-stack)
10. [Performance Strategy](#10-performance-strategy)
11. [File Structure](#11-file-structure)
12. [30-Day Build Roadmap](#12-30-day-build-roadmap)
13. [Appendix: Code Snippets](#13-appendix-code-snippets)

---

## 1. CREATIVE VISION

### One-Sentence Pitch
An explorable, living galaxy where every star is a company, every constellation is a transformation strategy, and every trajectory is a path to AI maturity — built to be the most beautiful data visualization on the internet.

### Emotional Target
**Awe, then understanding.** The user should gasp on landing, then stay because the data is genuinely useful. The galaxy is not a gimmick — it is the interface.

### Aesthetic References
- **NASA Eyes on the Solar System** — scientific accuracy, smooth camera work
- **Stripe Press book covers** — restrained typography, generous whitespace
- **Monocle magazine** — editorial confidence, no shouting
- **Ryoji Ikeda installations** — data as beauty, minimal color
- **Ethiopian illuminated manuscripts** — geometric precision, sacred geometry

### Design Philosophy
- **The 3D space is the UI.** No sidebars. No dashboards. No panels. The galaxy IS the interface.
- **Information appears only when requested.** Default state is pure space. Data emerges on hover, click, or voice.
- **Every pixel is intentional.** No particle clutter. No noise. Every star earns its place.
- **Motion is the language.** Camera movement tells the story. Zoom = narrative progression.

---

## 2. VISUAL DESIGN SYSTEM

### 2.1 Color Palette — Deep Space Edition

The galaxy exists in darkness. The palette is restrained to 6 colors plus white. No gradients in UI. Subtle gradients ONLY in 3D atmospheric effects.

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--void` | `#030308` | 3, 3, 8 | Background — deep space black with blue undertone |
| `--nebula` | `#0A0A1A` | 10, 10, 26 | Secondary background — distant galaxy regions |
| `--star-bright` | `#FFFFFF` | 255, 255, 255 | Primary stars, active elements, text |
| `--star-dim` | `#4A4A6A` | 74, 74, 106 | Distant stars, inactive elements |
| `--maturity-low` | `#FF6B35` | 255, 107, 53 | Low AI maturity — warm, warning |
| `--maturity-mid` | `#F7C548` | 247, 197, 72 | Medium AI maturity — amber, transition |
| `--maturity-high` | `#00D9C0` | 0, 217, 192 | High AI maturity — teal, achieved |
| `--trajectory` | `#7B61FF` | 123, 97, 255 | Transformation paths — violet, aspirational |
| `--accent-glow` | `rgba(0, 217, 192, 0.15)` | — | Bloom halos around high-maturity stars |

**Rules:**
- Stars are NEVER rainbow. They are white, dim, or one of three maturity colors.
- Trajectory lines are violet ONLY.
- UI text is white or dim. No colored text in UI chrome.
- Atmospheric nebula effects use `#0A0A1A` to `#030308` radial gradients ONLY.

### 2.2 Typography

| Element | Font | Size | Weight | Color | Notes |
|---------|------|------|--------|-------|-------|
| Galaxy Title (overlay) | Geist | 72px | 600 | `#FFFFFF` | Only on landing, fades after 3s |
| Section Title | Geist | 32px | 600 | `#FFFFFF` | Appears on camera lock |
| Star Label | Geist | 14px | 500 | `#FFFFFF` | Floating in 3D space, billboarded |
| Tooltip Title | Geist | 16px | 600 | `#FFFFFF` | |
| Tooltip Body | Geist | 14px | 400 | `#B0B0C8` | Muted lavender-gray |
| Tooltip Metric | Geist | 24px | 600 | `#00D9C0` | Large numbers |
| UI Chrome | Geist | 12px | 500 | `#6B6B8A` | Bottom bar, controls |
| Button | Geist | 14px | 500 | `#FFFFFF` | |

**Rules:**
- All text in 3D space uses `billboard` rendering (always faces camera).
- No text shadows. Text lives in clean space.
- Letter-spacing: -0.02em for titles, 0.05em for labels.

### 2.3 Spacing & Composition

- **Camera default distance:** 800 units from galaxy center.
- **Galaxy radius:** 400 units.
- **Star density:** ~500 stars in full dataset, ~200 visible at default zoom.
- **Minimum star separation:** 8 units (force-directed repulsion).
- **UI safe zone:** 60px from all edges. No UI elements touch screen borders.

### 2.4 Decorative Motifs

**Ethiopian Cross Constellations:**
- When stars cluster by industry, faint geometric lines connect them in Ethiopian cross patterns.
- Lines are `#1A1A3A` at 30% opacity — visible on close inspection, invisible at distance.
- Pattern emerges only when zoomed to constellation level.

**Jamaican Quilt Grid:**
- Background grid at galaxy periphery uses quilt-block tessellation.
- Grid is `#0A0A1A` on `#030308` — nearly invisible, adds texture on pan.

---

## 3. 3D AESTHETIC SPECIFICATION

### 3.1 The Stars

**Visual Properties:**
- **Geometry:** Icosahedron with 2 subdivisions (80 faces) — not perfect spheres, slightly faceted for premium feel.
- **Material:** `MeshBasicMaterial` with additive blending. No lighting needed — stars are self-illuminating.
- **Size:** Base radius 1.5 units. Scales with maturity (1.0 for low, 2.0 for high).
- **Color:** White (`#FFFFFF`) by default. Maturity colors applied as emissive tint.

**Star Types:**
| Type | Visual | Behavior |
|------|--------|----------|
| **Distant** | 1px point, `#4A4A6A`, no geometry | Always visible, parallax at 0.3x |
| **Background** | Small icosahedron, `#8A8AAA`, subtle pulse | Parallax at 0.6x |
| **Data Star** | Medium icosahedron, maturity color, bloom | Interactive, parallax at 1.0x |
| **Featured** | Large icosahedron, white core + teal glow, strong bloom | Pulsing rhythm, attracts attention |

**Pulse Animation:**
- Featured stars pulse in brightness: `opacity 0.8 → 1.0 → 0.8` over 4s.
- Pulse is synchronized to a subtle ambient audio tone (if audio enabled).
- Low-maturity stars have irregular flicker (simulated instability).
- High-maturity stars have steady, slow breathe.

### 3.2 The Bloom / Glow System

**Post-Processing Stack:**
1. **Unreal Bloom Pass**
   - Strength: 1.2
   - Radius: 0.8
   - Threshold: 0.7 (only very bright elements bloom)
2. **Tone Mapping:** ACESFilmic
   - Exposure: 1.0
3. **Output Encoding:** sRGB

**Bloom Rules:**
- Only stars with maturity > 60 get bloom.
- Bloom color matches star color (teal for high, amber for mid, orange for low).
- Trajectory lines get subtle violet bloom.
- UI elements NEVER bloom.

### 3.3 The Nebula / Atmosphere

**Background:**
- Solid `#030308` — no stars, no texture. Pure void.
- Faint radial gradient from center: `#0A0A1A` (center, 10% opacity) to `#030308` (edge).
- Gradient is CSS background, not 3D — performance optimization.

**Dust Particles:**
- 2,000 tiny points (`Points` geometry, not `PointsMaterial`).
- Color: `#1A1A3A` at 20% opacity.
- Size: 0.3 units.
- Movement: Static. No animation. They are reference points for parallax.
- Distribution: Spherical shell at radius 600–800 units.

### 3.4 Constellation Lines

**Visual:**
- Thin lines connecting related stars (same industry, same ERP, same PE firm).
- Material: `LineBasicMaterial`, `#1A1A3A`, opacity 0.3.
- Width: 1px (native WebGL line width).

**Behavior:**
- Invisible at galaxy zoom level.
- Fade in at constellation zoom level (camera distance < 300).
- Full opacity at planet zoom level (camera distance < 100).
- Lines draw on with animation: `dashOffset` from full length to 0 over 1.5s when entering view.

### 3.5 Trajectory Paths

**Visual:**
- Curved spline (Catmull-Rom) from current star position to target position.
- Material: `LineBasicMaterial`, `#7B61FF`, opacity 0.6.
- Width: 2px.
- Glow: Subtle bloom on trajectory lines.

**Animation:**
- Path draws on over 2s when activated.
- A small orb travels along the path at constant speed (2s duration).
- Orb leaves a fading trail (trail renderer or instanced mesh).
- Path fades out 3s after draw completes.

### 3.6 The Camera

**Movement Philosophy:**
- Camera is a spacecraft. Smooth, inertia-based, cinematic.
- No abrupt cuts. Every transition is a journey.
- Default: slow orbit around galaxy center (0.05 deg/frame).

**Controls:**
- **Orbit:** Left-click drag (rotate around focus point).
- **Pan:** Right-click drag (move focus point).
- **Zoom:** Scroll wheel (dolly in/out, NOT FOV change).
- **Focus:** Double-click star → camera animates to planet view.
- **Reset:** Press `Esc` → camera animates back to galaxy view.

**Animation Specs:**
- All camera movements use `camera-controls` with `smoothTime: 1.2` and `draggingSmoothTime: 0.3`.
- Focus transition: 1.5s, `ease: easeInOutCubic`.
- Reset transition: 2.0s, `ease: easeOutQuart`.

---

## 4. SCENE ARCHITECTURE

### 4.1 Scene Graph

```
Scene
├── Camera (PerspectiveCamera, fov: 60, near: 0.1, far: 5000)
│   └── CameraControls (smooth orbit, pan, zoom)
├── PostProcessing
│   ├── EffectComposer
│   │   ├── RenderPass
│   │   ├── UnrealBloomPass
│   │   └── OutputPass
├── GalaxyGroup (rotates slowly, 0.02 deg/frame)
│   ├── StarsGroup (500 instanced meshes)
│   │   ├── StarInstances (maturity-colored, interactive)
│   │   └── BackgroundStars (dim, static)
│   ├── ConstellationLines (LineSegments, fade by distance)
│   ├── TrajectoryPaths (CatmullRomCurve3, animated draw)
│   └── DustParticles (Points, static)
├── UIOverlay (HTML, absolute positioned, pointer-events: none)
│   ├── LandingTitle (fades after 3s)
│   ├── BottomBar (controls, zoom level, star count)
│   ├── Tooltip (follows cursor, appears on hover)
│   └── ModeIndicator (Galaxy / Constellation / Planet)
└── AmbientAudio (optional, generative drone)
```

### 4.2 LOD (Level of Detail) System

| Zoom Level | Camera Distance | Visible Elements | Detail Level |
|------------|----------------|------------------|--------------|
| **Galaxy** | > 400 | All stars as points/dots. No labels. No lines. | Star color + size only |
| **Constellation** | 150–400 | Stars as icosahedrons. Constellation lines visible. Industry labels. | Star name + maturity score |
| **Planet** | < 150 | Single star as large sphere with rings. Orbital system visible. Full data. | All metrics, trajectory, comparison |

**Transition:**
- Elements fade in/out based on camera distance, not hard switches.
- Fade range: 50 units (e.g., constellation lines start fading at 450, fully visible at 400).

### 4.3 Instanced Rendering

**Critical for performance:**
- All 500 stars use `InstancedMesh` with a single geometry and material.
- Per-instance attributes: `position`, `color`, `scale`, `maturity`.
- Only the hovered/selected star gets its own mesh for independent animation.
- Background dust uses `Points` with `BufferGeometry`.

---

## 5. USER JOURNEYS & FLOWS

### 5.1 Flow 1: First Visit (The Reveal)

```
1. User lands on black screen.
2. After 500ms, faint stars begin appearing (opacity 0 → 1, staggered by distance).
3. Title fades in: "The AI Transformation Galaxy" (center, 72px, fades after 3s).
4. Subtitle: "500 companies. One universe. Explore." (fades after 4s).
5. Camera begins slow orbit. Stars continue appearing over 5s.
6. Bottom bar fades in: "Drag to orbit • Scroll to zoom • Double-click to explore"
7. User interacts.
```

**Animation Timing:**
- Frame 0 (0ms): Black screen.
- Frame 30 (500ms): First stars appear (nearest to camera).
- Frame 60 (1000ms): Title fades in.
- Frame 240 (4000ms): Title fades out.
- Frame 300 (5000ms): All stars visible. Full interactivity.

### 5.2 Flow 2: Galaxy Exploration

```
1. User drags to orbit, scrolls to zoom.
2. Stars have hover state: scale 1.0 → 1.3, bloom intensifies.
3. Tooltip appears on hover:
   - Company name (16px, bold)
   - Industry + ERP system (14px, muted)
   - Maturity score: 73/100 (24px, teal)
   - "Double-click to explore" hint (12px, dim)
4. Tooltip follows cursor with 50ms lag (smooth lerp).
5. Constellation lines fade in as user zooms.
```

### 5.3 Flow 3: Planet View (Deep Dive)

```
1. User double-clicks a star.
2. Camera animates toward star (1.5s, smooth).
3. All other stars fade to 20% opacity (focus effect).
4. Selected star scales up, rings appear (orbital system).
5. Rings represent:
   - Inner ring: Data infrastructure maturity
   - Middle ring: Workflow standardization
   - Outer ring: AI deployment status
6. Moons appear (small spheres orbiting):
   - Each moon = an AI capability (reconciliation, forecasting, etc.)
   - Moon size = capability maturity
   - Moon color = same maturity scale
7. Right panel slides in (HTML overlay, 400px wide):
   - Company name, industry, ERP
   - Full maturity breakdown (5 dimensions, radar chart)
   - "See Trajectory" button
   - "Compare" button
   - "Contact Primero" CTA
8. "Back to Galaxy" button (top-left, always visible).
```

### 5.4 Flow 4: Trajectory View

```
1. In Planet view, user clicks "See Trajectory".
2. Violet spline path draws from current star to target position.
3. Small orb travels along path (2s).
4. Target star (future state) appears as ghosted sphere.
5. Milestones appear along path:
   - Month 3: Workflow standardization complete
   - Month 6: First agent deployed
   - Month 12: Full cluster deployment
6. EBITDA impact floats above target: "+$2.4M annualized"
7. User can scrub timeline (bottom slider) to see intermediate states.
```

### 5.5 Flow 5: PE Portfolio Mode (The Signature Feature)

```
1. User clicks "PE Portfolio Mode" (top-right button).
2. Modal: "Select 3–7 portfolio companies" → search + select.
3. Selected companies highlight in galaxy (pulsing white rings).
4. Camera animates to frame all selected stars.
5. "Standardize" phase:
   - Animation: Workflow rings align across all selected stars.
   - Lines connect stars (shared workflow logic).
   - Text: "Standardizing workflows..."
6. "Cluster" phase:
   - Animation: Stars rearrange into groups by shared logic.
   - Groups color-code (same hue, different saturation).
   - Text: "Clustering by shared logic..."
7. "Deploy" phase:
   - Animation: Agent orbs (glowing spheres) fly from center to clusters.
   - Each cluster gets 1–3 agents.
   - Agent orbs orbit cluster center.
   - Text: "Deploying reusable AI agents..."
8. Results:
   - Portfolio EBITDA: before/after counter animation.
   - Exit multiple: before/after.
   - Holding period: before/after.
   - "Download Playbook" CTA.
   - "Schedule Assessment" CTA.
```

### 5.6 Flow 6: Add Your Company

```
1. User clicks "Add Your Company" (bottom bar).
2. Minimal form slides up (3 fields):
   - Company name
   - Industry (dropdown)
   - ERP system (dropdown)
   - Current AI status (slider: 0–100)
3. On submit:
   - New star appears in galaxy at calculated position.
   - Camera animates to new star.
   - "Your company is here. See your trajectory?" prompt.
4. Star is saved to localStorage (persists across sessions).
```

---

## 6. COMPONENT LIBRARY

### 6.1 3D Components (React Three Fiber)

#### `<GalaxyScene />`
- Root 3D component. Manages scene, camera, post-processing.
- Props: `data`, `mode`, `selectedStar`, `onStarHover`, `onStarClick`.

#### `<StarField />`
- Instanced mesh of all 500 stars.
- Uses `useMemo` for geometry/material.
- Per-instance color/scale via `instanceColor` attribute.
- Hover detection via raycaster.

#### `<Star />` (Individual)
- Used ONLY for hovered/selected stars.
- Has its own mesh for independent animation.
- Pulse animation via `useFrame`.

#### `<ConstellationLines />`
- `LineSegments` geometry.
- Visibility controlled by camera distance.
- Dash animation via `useFrame` updating `dashOffset`.

#### `<TrajectoryPath />`
- `CatmullRomCurve3` + `TubeGeometry` (or `Line` for performance).
- Animated draw via `useFrame` updating geometry draw range.
- Traveling orb via `getPointAt(t)` along curve.

#### `<PlanetRings />`
- Three torus geometries (inner, middle, outer).
- Rotate slowly around star axis.
- Opacity pulses with maturity rhythm.

#### `<DustParticles />`
- `Points` with `BufferGeometry`.
- 2,000 points, static positions.
- Parallax via camera position offset.

#### `<CameraRig />`
- Wraps `CameraControls`.
- Manages smooth transitions between views.
- Exposes `focusOn(star)`, `reset()`, `setMode(mode)` methods.

### 6.2 UI Components (HTML Overlay)

#### `<LandingTitle />`
- Absolute center. Fades in at 1s, out at 4s.
- `pointer-events: none`.

#### `<Tooltip />`
- Follows cursor with 50ms lag (`lerp`).
- Appears on star hover. Disappears on mouse leave.
- Position: cursor + 16px offset.
- Background: `rgba(3, 3, 8, 0.9)` + `backdrop-filter: blur(12px)`.
- Border: 1px `#1A1A3A`.
- Border radius: 8px.
- Padding: 16px.
- Max width: 280px.

#### `<BottomBar />`
- Fixed bottom, full width, height 48px.
- Background: gradient from transparent to `rgba(3, 3, 8, 0.8)`.
- Left: "Primero Galaxy" wordmark + star count.
- Center: Mode indicator (Galaxy / Constellation / Planet).
- Right: "Add Company" + "PE Portfolio Mode" buttons.

#### `<PlanetPanel />`
- Fixed right, width 400px, full height.
- Background: `rgba(3, 3, 8, 0.95)` + `backdrop-filter: blur(20px)`.
- Border-left: 1px `#1A1A3A`.
- Slides in from right (translateX: 100% → 0, 600ms, ease-decelerate).
- Content:
  - Company header (name, industry, ERP)
  - Maturity radar chart (SVG)
  - 5 dimension scores (progress bars)
  - "See Trajectory" button
  - "Compare" button
  - "Contact Primero" CTA

#### `<PEPortfolioModal />`
- Centered modal, 600px wide.
- Background: `rgba(3, 3, 8, 0.98)` + `backdrop-filter: blur(24px)`.
- Border: 1px `#1A1A3A`, radius 12px.
- Step 1: Company selection (search + multi-select list).
- Step 2: Animation playback (Standardize → Cluster → Deploy).
- Step 3: Results (EBITDA, multiple, holding period counters).

#### `<RadarChart />`
- SVG, 200px × 200px.
- 5 axes: Data Infrastructure, Workflow Standardization, AI Deployment, Governance, Talent.
- Fill: `rgba(0, 217, 192, 0.2)`.
- Stroke: `#00D9C0`, 2px.
- Grid: `#1A1A3A`, 1px.
- Animated draw on mount (stroke-dashoffset).

---

## 7. DATA MODEL

### 7.1 Company Schema

```typescript
interface Company {
  id: string;                    // UUID
  name: string;                  // "Acme Manufacturing"
  slug: string;                  // "acme-manufacturing"
  industry: Industry;            // "Manufacturing" | "Healthcare" | "SaaS" | "Fintech" | "Logistics"
  erpSystem: ERPSystem;          // "NetSuite" | "SAP" | "Oracle" | "Workday" | "Microsoft Dynamics"
  size: CompanySize;             // "<50" | "50-200" | "200-500" | "500-1000" | "1000+"

  // Maturity scores (0-100)
  maturity: {
    overall: number;             // Weighted average
    dataInfrastructure: number;  // Data quality, pipelines, accessibility
    workflowStandardization: number; // SOPs, consistency, documentation
    aiDeployment: number;        // Live AI use cases, scale
    governance: number;          // ISO 42001, policies, ethics
    talent: number;              // AI/ML team size, skills
  };

  // Position in galaxy (pre-computed via force-directed layout)
  position: {
    x: number;
    y: number;
    z: number;
  };

  // Constellation grouping
  constellationId: string;       // Group ID for related companies
  peFirm?: string;               // If PE-backed

  // Trajectory (if applicable)
  trajectory?: {
    targetPosition: { x, y, z };
    milestones: Milestone[];
    projectedEbitdaImpact: number;
    projectedMultipleImprovement: number;
    projectedHoldingPeriodReduction: number;
  };

  // Metadata
  founded: number;               // Year
  revenue: number;               // Annual revenue (USD, millions)
  employees: number;
  location: string;              // "Austin, TX"

  // Flags
  isFeatured: boolean;           // Highlighted in galaxy
  isUserAdded: boolean;          // Added via "Add Your Company"
}

interface Milestone {
  month: number;                 // 1-36
  title: string;                 // "Workflow standardization complete"
  description: string;
  impact: number;                // EBITDA impact at this milestone
}

type Industry = 'Manufacturing' | 'Healthcare' | 'SaaS' | 'Fintech' | 'Logistics' | 'Retail' | 'Energy';
type ERPSystem = 'NetSuite' | 'SAP' | 'Oracle' | 'Workday' | 'Microsoft Dynamics' | 'Sage' | 'Custom';
type CompanySize = '<50' | '50-200' | '200-500' | '500-1000' | '1000+';
```

### 7.2 Galaxy Layout Algorithm

**Force-Directed 3D Layout (d3-force-3d):**

```typescript
import { forceSimulation, forceManyBody, forceCenter, forceLink, forceCollide } from 'd3-force-3d';

function computeGalaxyLayout(companies: Company[]) {
  const simulation = forceSimulation(companies, 3) // 3D
    .force('charge', forceManyBody().strength(-30))
    .force('center', forceCenter(0, 0, 0))
    .force('collision', forceCollide().radius(d => d.maturity.overall / 20 + 2))
    .force('industry-cluster', forceLink()
      .links(generateIndustryLinks(companies))
      .strength(0.5)
      .distance(50)
    )
    .force('maturity-repel', forceManyBody()
      .strength(d => d.maturity.overall > 70 ? -10 : 0)
    );

  // Run for 300 iterations
  for (let i = 0; i < 300; i++) simulation.tick();

  return companies.map(c => ({
    ...c,
    position: { x: c.x, y: c.y, z: c.z }
  }));
}
```

**Layout Rules:**
- High-maturity companies repel each other slightly (they're "leaders" with space).
- Same-industry companies attract (clusters).
- Same-ERP companies have weak attraction (sub-clusters within industry).
- Minimum distance: 8 units between any two stars.
- Galaxy shape: roughly spherical, radius ~400 units.

### 7.3 Initial Dataset (500 Companies)

**Synthetic data generation:**
- 500 companies across 7 industries.
- 60% NetSuite, 20% SAP, 10% Oracle, 10% other.
- Maturity distribution: 20% low (0-40), 50% mid (40-70), 30% high (70-100).
- 50 PE-backed companies (10% of dataset).
- 10 featured companies (high maturity, interesting trajectories).

**Data source:** Public company data (Crunchbase, LinkedIn) + synthetic maturity scores based on your methodology.

---

## 8. ANIMATION & MOTION

### 8.1 Camera Motion

| Transition | Duration | Easing | Behavior |
|------------|----------|--------|----------|
| Galaxy → Constellation | 1.5s | easeInOutCubic | Dolly in + slight orbit adjustment |
| Constellation → Planet | 1.5s | easeInOutCubic | Dolly in to star, other stars fade |
| Planet → Galaxy | 2.0s | easeOutQuart | Dolly out, all stars fade back in |
| Focus on star | 1.5s | easeInOutCubic | Camera moves to star + offset |
| Reset view | 2.0s | easeOutQuart | Return to default galaxy view |
| PE Portfolio frame | 2.0s | easeInOutCubic | Camera positions to frame all selected stars |

### 8.2 Star Animations

| Animation | Trigger | Duration | Easing |
|-----------|---------|----------|--------|
| Appear (landing) | Page load | 5s total | Staggered by distance from camera |
| Hover scale | Mouse enter | 300ms | easeOutQuart |
| Hover bloom | Mouse enter | 300ms | easeOutQuart |
| Pulse (featured) | Continuous | 4s loop | sine wave |
| Flicker (low maturity) | Continuous | Random 2-5s | noise |
| Select scale | Double-click | 600ms | easeOutElastic (subtle) |

### 8.3 Line Animations

| Animation | Trigger | Duration | Easing |
|-----------|---------|----------|--------|
| Constellation draw | Camera distance < 400 | 1.5s | easeInOutCubic |
| Trajectory draw | "See Trajectory" click | 2.0s | easeInOutCubic |
| Trajectory orb travel | After draw complete | 2.0s | linear |

### 8.4 UI Animations

| Animation | Trigger | Duration | Easing |
|-----------|---------|----------|--------|
| Landing title fade in | 1s after load | 800ms | easeOutQuart |
| Landing title fade out | 4s after load | 600ms | easeInQuart |
| Tooltip appear | Star hover | 200ms | easeOutQuart |
| Tooltip follow | Mouse move | 50ms lag | lerp 0.1 |
| Planet panel slide in | Planet view | 600ms | easeOutQuart |
| Planet panel slide out | Exit planet view | 400ms | easeInQuart |
| Bottom bar fade in | After landing | 800ms | easeOutQuart |
| Modal open | Button click | 400ms | easeOutQuart |
| Modal close | Close button | 300ms | easeInQuart |

### 8.5 PE Portfolio Mode Animations

| Phase | Animation | Duration |
|-------|-----------|----------|
| Standardize | Workflow rings align across stars + connecting lines draw | 3s |
| Cluster | Stars drift into groups by shared logic | 2s |
| Deploy | Agent orbs fly from center to clusters + begin orbit | 3s |
| Results | Counters animate from 0 to final values | 2s |

---

## 9. TECHNICAL STACK

### 9.1 Core

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Framework | Next.js | 14+ (App Router) | SSR, routing, API routes |
| Language | TypeScript | 5.3+ | Type safety |
| Styling | Tailwind CSS | 3.4+ | UI overlay styling |
| UI Components | shadcn/ui | Latest | Modals, buttons, inputs |

### 9.2 3D

| Library | Version | Purpose |
|---------|---------|---------|
| Three.js | ^0.160.0 | Core WebGL engine |
| React Three Fiber | ^8.15.0 | React renderer for Three.js |
| @react-three/drei | ^9.92.0 | Helpers (Stars, OrbitControls, Text, etc.) |
| @react-three/postprocessing | ^2.15.0 | Bloom, tone mapping |
| postprocessing | ^6.33.0 | Post-processing effects |
| camera-controls | ^2.7.0 | Smooth camera transitions |
| three-stdlib | ^2.28.0 | Extended Three.js utilities |

### 9.3 Data & Layout

| Library | Version | Purpose |
|---------|---------|---------|
| d3-force-3d | ^3.0.0 | Force-directed galaxy layout |
| d3-scale | ^4.0.0 | Color scales, size scales |
| zustand | ^4.4.0 | Global state (camera, selected star, mode) |

### 9.4 Animation

| Library | Version | Purpose |
|---------|---------|---------|
| Framer Motion | ^11.0.0 | UI overlay animations |
| GSAP | ^3.12.0 | Complex timeline animations (PE Portfolio mode) |

### 9.5 Dependencies

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "typescript": "^5.3.0",
    "tailwindcss": "^3.4.0",
    "three": "^0.160.0",
    "@react-three/fiber": "^8.15.0",
    "@react-three/drei": "^9.92.0",
    "@react-three/postprocessing": "^2.15.0",
    "postprocessing": "^6.33.0",
    "camera-controls": "^2.7.0",
    "three-stdlib": "^2.28.0",
    "d3-force-3d": "^3.0.0",
    "d3-scale": "^4.0.0",
    "zustand": "^4.4.0",
    "framer-motion": "^11.0.0",
    "gsap": "^3.12.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0"
  },
  "devDependencies": {
    "@types/three": "^0.160.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "eslint": "^8.0.0",
    "eslint-config-next": "^14.0.0"
  }
}
```

---

## 10. PERFORMANCE STRATEGY

### 10.1 Rendering Optimizations

| Technique | Implementation | Impact |
|-----------|---------------|--------|
| **InstancedMesh** | All 500 stars in one draw call | 50x fewer draw calls |
| **LOD** | Distant stars as Points, close as Mesh | Reduces vertex count 10x |
| **Frustum Culling** | Three.js built-in | Skips off-screen objects |
| **Occlusion Culling** | Custom: hide stars behind others at high zoom | Reduces overdraw |
| **Texture Atlasing** | Single texture for all star sprites | Fewer texture binds |
| **Post-processing limit** | Bloom only, no SSAO/SSR | Saves 5-10ms/frame |

### 10.2 Target Performance

| Metric | Target | Measurement |
|--------|--------|-------------|
| Frame Rate | 60fps locked | Chrome DevTools FPS meter |
| Draw Calls | < 50 | Chrome DevTools Render tab |
| GPU Time | < 8ms/frame | Chrome DevTools GPU tab |
| Initial Load | < 3s | Lighthouse |
| Time to Interactive | < 4s | Lighthouse |

### 10.3 Mobile Strategy

**Desktop-first, graceful degradation:**
- Mobile gets simplified 2D canvas fallback (D3 force-directed graph, not Three.js).
- Or: Mobile shows pre-rendered video of galaxy with touch-to-explore hotspots.
- Or: Mobile gets "light mode" — 100 stars instead of 500, no bloom, no dust.

**Decision:** Build desktop first. Mobile fallback decided in Week 3 based on performance testing.

### 10.4 Asset Optimization

- **No external textures.** All visuals are procedural (geometry, shaders, math).
- **No video assets.** All motion is real-time rendered.
- **Font:** Geist loaded via `next/font` (subset, preload).
- **Code splitting:** Three.js loaded dynamically (`next/dynamic`) on galaxy route only.

---

## 11. FILE STRUCTURE

```
primero-galaxy/
├── app/
│   ├── layout.tsx                    # Root layout, fonts, metadata
│   ├── page.tsx                      # Galaxy page (3D canvas + UI overlay)
│   ├── globals.css                   # Tailwind + custom CSS variables
│   └── api/
│       └── companies/
│           └── route.ts              # API route for company data
├── components/
│   ├── galaxy/                       # 3D R3F components
│   │   ├── GalaxyScene.tsx           # Root scene wrapper
│   │   ├── StarField.tsx             # Instanced star mesh
│   │   ├── Star.tsx                  # Individual star (hover/selected)
│   │   ├── ConstellationLines.tsx    # Connecting lines
│   │   ├── TrajectoryPath.tsx        # Transformation path
│   │   ├── PlanetRings.tsx           # Orbital rings
│   │   ├── DustParticles.tsx         # Background dust
│   │   ├── CameraRig.tsx             # Camera controls + transitions
│   │   └── PostProcessing.tsx        # Bloom, tone mapping
│   ├── ui/                           # HTML overlay components
│   │   ├── LandingTitle.tsx          # Fade-in title
│   │   ├── Tooltip.tsx               # Star hover tooltip
│   │   ├── BottomBar.tsx             # Bottom control bar
│   │   ├── PlanetPanel.tsx           # Right-side detail panel
│   │   ├── PEPortfolioModal.tsx      # PE mode modal
│   │   ├── RadarChart.tsx            # SVG maturity chart
│   │   ├── AddCompanyForm.tsx        # Add company form
│   │   └── ModeIndicator.tsx         # Galaxy/Constellation/Planet badge
│   └── shared/                       # Shared components
│       ├── Button.tsx
│       ├── Modal.tsx
│       └── Input.tsx
├── hooks/
│   ├── useGalaxyData.ts              # Fetch + cache company data
│   ├── useCameraTransition.ts        # Smooth camera movements
│   ├── useStarHover.ts               # Raycaster hover detection
│   ├── useGalaxyLayout.ts            # d3-force-3d layout computation
│   └── useReducedMotion.ts           # Accessibility
├── lib/
│   ├── utils.ts                      # cn(), helpers
│   ├── galaxy-layout.ts              # Force-directed layout algorithm
│   ├── data-generator.ts             # Synthetic company data generator
│   └── constants.ts                  # Colors, sizes, thresholds
├── store/
│   └── galaxyStore.ts                # Zustand store (camera, mode, selection)
├── types/
│   └── index.ts                      # TypeScript interfaces
├── public/
│   └── (no assets — everything procedural)
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

---

## 12. 30-DAY BUILD ROADMAP

### Week 1: Foundation & Starfield

| Day | Task | Deliverable |
|-----|------|-------------|
| 1 | Initialize Next.js project, install all deps | `npm run dev` works |
| 2 | Set up Tailwind with custom color tokens | Dark theme active |
| 3 | Set up R3F canvas, basic scene, camera | Black canvas with orbit controls |
| 4 | Create `StarField` instanced mesh (500 stars) | 500 colored dots in space |
| 5 | Implement d3-force-3d layout algorithm | Stars positioned by force simulation |
| 6 | Add star hover detection (raycaster) + tooltip | Hover shows company name |
| 7 | Polish star visuals (icosahedron, size by maturity) | Stars look premium, not dots |

**Week 1 Exit Criteria:**
- 500 stars rendered in 3D space.
- Force-directed layout working.
- Hover shows tooltip with company name.
- 60fps on desktop.

### Week 2: Camera, Constellations & Trajectories

| Day | Task | Deliverable |
|-----|------|-------------|
| 8 | Implement `CameraRig` with smooth transitions | Camera moves smoothly between views |
| 9 | Add constellation lines (fade by distance) | Lines appear on zoom |
| 10 | Add dust particles (static, parallax) | Subtle depth effect |
| 11 | Implement bloom post-processing | Stars glow appropriately |
| 12 | Add landing title animation | Beautiful entry sequence |
| 13 | Implement double-click → Planet view | Camera zooms to star |
| 14 | Add "Back to Galaxy" button + transition | Smooth exit from Planet view |

**Week 2 Exit Criteria:**
- Galaxy → Constellation → Planet camera flow works.
- Bloom and dust add atmosphere.
- Landing sequence is mesmerizing.

### Week 3: Planet View & UI Overlay

| Day | Task | Deliverable |
|-----|------|-------------|
| 15 | Build `PlanetPanel` (right slide-in) | Panel shows company details |
| 16 | Add planet rings (3 torus, maturity-coded) | Orbital system visible |
| 17 | Build SVG radar chart component | Maturity visualization |
| 18 | Add "See Trajectory" button + path animation | Violet path draws to target |
| 19 | Implement trajectory orb travel | Orb moves along path |
| 20 | Add "Compare" mode (side-by-side stars) | Two stars compared |
| 21 | Polish all UI animations (Framer Motion) | Everything feels smooth |

**Week 3 Exit Criteria:**
- Planet view is fully functional.
- Trajectory animation is cinematic.
- UI overlay is polished and responsive.

### Week 4: PE Portfolio Mode & Polish

| Day | Task | Deliverable |
|-----|------|-------------|
| 22 | Build `PEPortfolioModal` (company selection) | Modal with search + multi-select |
| 23 | Implement "Standardize" animation phase | Workflow rings align |
| 24 | Implement "Cluster" animation phase | Stars rearrange into groups |
| 25 | Implement "Deploy" animation phase | Agent orbs fly to clusters |
| 26 | Add results counters (EBITDA, multiple, holding period) | Animated numbers |
| 27 | Add "Add Your Company" form + localStorage | Users can add their own star |
| 28 | Performance audit + optimization | 60fps locked, < 3s load |
| 29 | Accessibility pass (reduced motion, keyboard nav) | WCAG compliant |
| 30 | Deploy to Vercel + screen recording for LinkedIn | Live site + marketing asset |

**Week 4 Exit Criteria:**
- PE Portfolio Mode is demo-worthy.
- Site is live on Vercel.
- 60fps maintained.
- Screen recording ready for LinkedIn launch.

---

## 13. APPENDIX: CODE SNIPPETS

### 13.1 StarField Instanced Mesh

```tsx
// components/galaxy/StarField.tsx
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Company } from '@/types';

interface StarFieldProps {
  companies: Company[];
  onStarHover: (company: Company | null) => void;
}

export function StarField({ companies, onStarHover }: StarFieldProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const hoveredIndex = useRef<number>(-1);

  const geometry = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 2); // Faceted sphere
    return geo;
  }, []);

  const material = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false, // For bloom
    });
  }, []);

  // Set initial positions, colors, scales
  useMemo(() => {
    if (!meshRef.current) return;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    companies.forEach((company, i) => {
      dummy.position.set(company.position.x, company.position.y, company.position.z);

      // Scale by maturity
      const scale = 1 + (company.maturity.overall / 100) * 1.5;
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();

      meshRef.current!.setMatrixAt(i, dummy.matrix);

      // Color by maturity
      if (company.maturity.overall > 70) color.set('#00D9C0');
      else if (company.maturity.overall > 40) color.set('#F7C548');
      else color.set('#FF6B35');

      meshRef.current!.setColorAt(i, color);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  }, [companies]);

  // Pulse animation for featured stars
  useFrame((state) => {
    if (!meshRef.current) return;

    const time = state.clock.elapsedTime;
    const dummy = new THREE.Object3D();

    companies.forEach((company, i) => {
      if (!company.isFeatured) return;

      meshRef.current!.getMatrixAt(i, dummy.matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);

      const pulse = 1 + Math.sin(time * 1.5) * 0.1;
      const baseScale = 1 + (company.maturity.overall / 100) * 1.5;
      dummy.scale.set(baseScale * pulse, baseScale * pulse, baseScale * pulse);
      dummy.updateMatrix();

      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, companies.length]}
      onPointerMove={(e) => {
        e.stopPropagation();
        const instanceId = e.instanceId;
        if (instanceId !== undefined) {
          hoveredIndex.current = instanceId;
          onStarHover(companies[instanceId]);
        }
      }}
      onPointerOut={() => {
        hoveredIndex.current = -1;
        onStarHover(null);
      }}
    />
  );
}
```

### 13.2 Camera Transition Hook

```tsx
// hooks/useCameraTransition.ts
import { useRef, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import CameraControls from 'camera-controls';
import * as THREE from 'three';

CameraControls.install({ THREE });

export function useCameraTransition() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<CameraControls>(null);

  const focusOn = useCallback((position: THREE.Vector3, offset = new THREE.Vector3(0, 0, 50)) => {
    if (!controlsRef.current) return;

    const target = position.clone();
    const cameraPos = position.clone().add(offset);

    controlsRef.current.setLookAt(
      cameraPos.x, cameraPos.y, cameraPos.z,
      target.x, target.y, target.z,
      true // enable transition
    );

    controlsRef.current.smoothTime = 1.2;
  }, []);

  const reset = useCallback(() => {
    if (!controlsRef.current) return;

    controlsRef.current.setLookAt(
      0, 0, 800, // camera position
      0, 0, 0,   // target
      true
    );

    controlsRef.current.smoothTime = 2.0;
  }, []);

  return { controlsRef, focusOn, reset };
}
```

### 13.3 Galaxy Store (Zustand)

```tsx
// store/galaxyStore.ts
import { create } from 'zustand';
import { Company, GalaxyMode } from '@/types';

interface GalaxyState {
  mode: GalaxyMode;
  selectedStar: Company | null;
  hoveredStar: Company | null;
  portfolioStars: Company[];
  isPEMode: boolean;

  setMode: (mode: GalaxyMode) => void;
  selectStar: (star: Company | null) => void;
  hoverStar: (star: Company | null) => void;
  togglePortfolioStar: (star: Company) => void;
  setPEMode: (active: boolean) => void;
}

export const useGalaxyStore = create<GalaxyState>((set) => ({
  mode: 'galaxy',
  selectedStar: null,
  hoveredStar: null,
  portfolioStars: [],
  isPEMode: false,

  setMode: (mode) => set({ mode }),
  selectStar: (star) => set({ selectedStar: star, mode: star ? 'planet' : 'galaxy' }),
  hoverStar: (star) => set({ hoveredStar: star }),
  togglePortfolioStar: (star) => set((state) => {
    const exists = state.portfolioStars.find(s => s.id === star.id);
    if (exists) {
      return { portfolioStars: state.portfolioStars.filter(s => s.id !== star.id) };
    }
    if (state.portfolioStars.length >= 7) return state;
    return { portfolioStars: [...state.portfolioStars, star] };
  }),
  setPEMode: (active) => set({ isPEMode: active }),
}));
```

### 13.4 Tailwind Config (Dark Galaxy Theme)

```js
// tailwind.config.js
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        void: '#030308',
        nebula: '#0A0A1A',
        'star-bright': '#FFFFFF',
        'star-dim': '#4A4A6A',
        'maturity-low': '#FF6B35',
        'maturity-mid': '#F7C548',
        'maturity-high': '#00D9C0',
        trajectory: '#7B61FF',
        'ui-muted': '#6B6B8A',
        'ui-dim': '#B0B0C8',
        'border-subtle': '#1A1A3A',
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.8s ease-out forwards',
        'fade-out': 'fadeOut 0.6s ease-in forwards',
        'slide-in-right': 'slideInRight 0.6s ease-out forwards',
        'pulse-slow': 'pulseSlow 4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        pulseSlow: {
          '0%, 100%': { opacity: '0.8' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
```

### 13.5 Synthetic Data Generator

```tsx
// lib/data-generator.ts
import { Company, Industry, ERPSystem, CompanySize } from '@/types';

const INDUSTRIES: Industry[] = ['Manufacturing', 'Healthcare', 'SaaS', 'Fintech', 'Logistics', 'Retail', 'Energy'];
const ERPS: ERPSystem[] = ['NetSuite', 'SAP', 'Oracle', 'Workday', 'Microsoft Dynamics', 'Sage', 'Custom'];
const SIZES: CompanySize[] = ['<50', '50-200', '200-500', '500-1000', '1000+'];

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

function generateMaturity(): Company['maturity'] {
  const overall = randomInt(10, 98);
  return {
    overall,
    dataInfrastructure: Math.min(100, Math.max(0, overall + randomInt(-20, 20))),
    workflowStandardization: Math.min(100, Math.max(0, overall + randomInt(-15, 15))),
    aiDeployment: Math.min(100, Math.max(0, overall + randomInt(-30, 10))),
    governance: Math.min(100, Math.max(0, overall + randomInt(-25, 15))),
    talent: Math.min(100, Math.max(0, overall + randomInt(-20, 20))),
  };
}

export function generateCompanies(count: number): Company[] {
  return Array.from({ length: count }, (_, i) => {
    const industry = randomItem(INDUSTRIES);
    const erp = randomItem(ERPS);
    const maturity = generateMaturity();

    return {
      id: `company-${i}`,
      name: `Company ${i + 1}`,
      slug: `company-${i + 1}`,
      industry,
      erpSystem: erp,
      size: randomItem(SIZES),
      maturity,
      position: { x: 0, y: 0, z: 0 }, // Filled by layout algorithm
      constellationId: `${industry}-${erp}`,
      peFirm: Math.random() > 0.9 ? `PE Firm ${randomInt(1, 10)}` : undefined,
      founded: randomInt(1980, 2020),
      revenue: randomInt(5, 500),
      employees: randomInt(20, 5000),
      location: `City ${randomInt(1, 50)}, State`,
      isFeatured: Math.random() > 0.95,
      isUserAdded: false,
    };
  });
}
```

---

*This document is the single source of truth for the Primero Galaxy build. Any deviations require written approval from the project owner.*

*Document Version: 1.0*
*Last Updated: August 2026*
