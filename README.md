# Primero Galaxy

**The AI Transformation Maturity Galaxy** — an explorable 3D galaxy where every star is a company, every constellation is a transformation strategy, and every trajectory is a path to AI maturity. Built as an Awwwards-level data visualization: the galaxy *is* the interface.

500 companies. One universe. Explore.

## Features

- **500-star 3D galaxy** — instanced `IcosahedronGeometry` rendering with per-star maturity color (orange → amber → teal), bloom post-processing, and static dust particles for parallax depth.
- **Force-directed layout** — `d3-force-3d` positions companies so same-industry companies cluster and high-maturity leaders repel; the layout is pre-computed and served by the API.
- **Camera as spacecraft** — `camera-controls` with smooth inertia: drag to orbit, scroll to dolly, double-click a star to fly to planet view, `Esc` to return.
- **Hover → tooltip** — raycaster-driven hover shows company, industry, ERP, and maturity score in a cursor-following glass tooltip.
- **Planet view** — camera flies in, the star scales up with orbital rings, and a slide-in panel shows the full maturity breakdown: overall score, 5-dimension radar chart (SVG), animated dimension bars, and transformation trajectory with EBITDA impact, exit multiple, holding-period reduction, and milestone timeline.
- **Trajectory paths** — violet Catmull-Rom splines draw from a company to its projected future state in 3D space.
- **Add Your Company** — a minimal form (name, industry, ERP, AI status slider) places a new persistent star in the galaxy, saves it to `localStorage`, flies the camera to it, and offers a trajectory prompt. User stars can be removed from the galaxy with a two-step confirm and an Undo toast.
- **Toast system** — added/removed notifications survive a refresh (sessionStorage) but keep only their remaining window; expired toasts never resurrect.
- **Landing sequence** — staggered star appear, title fade in/out, bottom bar with mode indicator (Galaxy / Constellation / Planet) and star count.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router), TypeScript |
| 3D | Three.js, React Three Fiber, @react-three/drei |
| Post-processing | @react-three/postprocessing (UnrealBloom, ACESFilmic) |
| Camera | camera-controls |
| Layout | d3-force-3d |
| State | Zustand |
| Styling | Tailwind CSS, Framer Motion |
| Testing | Playwright (real-browser E2E) |

## Getting Started

```bash
npm install
npm run dev        # http://localhost:3000
```

- **`/`** — explainer landing page (what the galaxy is, how to read it, how to navigate), leading into the tool
- **`/galaxy`** — the 3D galaxy itself

> Tip: for the direct experience, open `http://localhost:3000/galaxy`.

Other scripts:

```bash
npm run build      # production build
npm run start      # serve the production build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run test:e2e   # Playwright E2E against a production build on :3100
```

The E2E suite proves the interaction pipeline with **real browser input**: boot + 500 stars, raycast → tooltip, double-click → planet view → trajectory → reset, the full add/delete/undo/localStorage loop, and toast remaining-window hydration.

## How It Works

- **Data** — `/api/companies` serves 500 deterministically generated companies (7 industries, 7 ERP systems, realistic maturity distributions, 50 PE-backed, 10 featured, seeded for reproducible tests). Layout positions are pre-computed with the force simulation.
- **Rendering** — all 500 stars share one `InstancedMesh` (one draw call); per-instance color and scale are set from maturity. Only hovered/selected stars get individual meshes. Dust is a static `Points` cloud.
- **LOD** — labels and constellation lines fade in based on camera distance, so the galaxy stays uncluttered at overview and data-rich up close.
- **Persistence** — user stars live in `localStorage`; pending toasts in `sessionStorage` (survive refresh, die with the tab).

## Project Structure

```
app/            Next.js routes: page (landing), galaxy/ (the tool), layout, /api/companies
components/
  galaxy/       3D scene: GalaxyScene, StarField, StarLabels, ConstellationLines,
                TrajectoryPath, PlanetSystem, DustParticles, CameraRig, PostProcessing
  ui/           Overlay: LandingTitle, Tooltip, BottomBar, PlanetPanel, RadarChart,
                AddCompanyForm, ToastStack, ModeIndicator
lib/            constants, data generator, galaxy layout, user-company helpers
store/          Zustand store (mode, selection, toasts, user stars)
types/          Company / Trajectory / Maturity data model
e2e/            Playwright specs
```

## Roadmap

The following handoff-spec features are stubbed in the UI as "Coming soon" and are the natural next milestones:

- **PE Portfolio Mode** — multi-select 3–7 portfolio companies, then watch Standardize → Cluster → Deploy animations and results counters.
- **Compare companies** — side-by-side maturity comparison.
- **Contact Primero** — the CTA currently anchors to `#contact`; wire it to a real contact form/route.
- **Ambient generative audio** with a mute control, plus a full `prefers-reduced-motion` pass.
- **Mobile strategy** — a light 3D mode or 2D fallback for touch devices.

## License

[MIT](LICENSE) © Primero. The design specification lives in `galaxy-handoff.md`.
