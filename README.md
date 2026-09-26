# Primero Galaxy

**The AI Transformation Maturity Galaxy**: an explorable 3D galaxy where every star is a real Fortune 500 enterprise, every constellation is a transformation strategy, and every trajectory is a path to AI maturity. Built as an Awwwards-level data visualization: the galaxy *is* the interface.

Real companies. One universe. Explore.

## Features

- **Fortune 500 3D galaxy**: instanced `IcosahedronGeometry` rendering of ~193 curated enterprises with per-star maturity color (orange → amber → teal), bloom post-processing, and static dust particles for parallax depth.
- **Force-directed layout**: `d3-force-3d` positions companies so same-industry companies cluster and high-maturity leaders repel; the layout is pre-computed and served by the API.
- **Camera as spacecraft**: `camera-controls` with smooth inertia: drag to orbit, scroll to dolly, double-click a star to fly to planet view, `Esc` to return.
- **Hover → tooltip**: raycaster-driven hover shows company, industry, and maturity score in a cursor-following glass tooltip.
- **Planet view**: camera flies in, the star scales up with orbital rings, and a slide-in panel shows the full maturity breakdown: overall score, 5-dimension radar chart (SVG), animated dimension bars, and transformation trajectory with EBITDA impact, exit multiple, holding-period reduction, and milestone timeline.
- **Trajectory paths**: violet Catmull-Rom splines draw from a company to its projected future state in 3D space.
- **Add Your Company**: a minimal form (name, industry, AI status slider) places a new persistent star in the galaxy, saves it to `localStorage`, flies the camera to it, and offers a trajectory prompt. User stars can be removed from the galaxy with a two-step confirm and an Undo toast.
- **Company search**: a search palette in the galaxy: type a name and fly straight to the star, with keyboard navigation (arrows + Enter) and results for both dataset and user-added stars.
- **Toast system**: added/removed notifications survive a refresh (sessionStorage) but keep only their remaining window; expired toasts never resurrect.
- **Landing sequence**: staggered star appear, title fade in/out, bottom bar with mode indicator (Galaxy / Constellation / Planet) and star count.

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

- **`/`**: explainer landing page (what the galaxy is, how to read it, how to navigate), leading into the tool
- **`/galaxy`**: the 3D galaxy itself

Three products live in this repo — Galaxy (`/`, `/galaxy`, `/system-map`, `/methodology`), the FinBench benchmark dashboard (`/finbench*`), and the Delegate workshop (`/delegate*`). See [The Circle extraction](#the-circle-extraction-shared-ui-primitives-and-filter-engine) for how they share one UI kit.

> Tip: for the direct experience, open `http://localhost:3000/galaxy`.

**Environment**: `NEXT_PUBLIC_SITE_URL` (see `.env.local.example`) is the absolute URL of the deployed app. It becomes the `metadataBase` that resolves the Open Graph / Twitter image URLs and the canonical link; without it, builds fall back to `http://localhost:3000`. CI injects the same value from the `NEXT_PUBLIC_SITE_URL` repository secret, so set that secret to the production domain once deployed.

Other scripts:

```bash
npm run build      # production build
npm run start      # serve the production build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run test:e2e   # Playwright E2E against a production build on :3100
```

The E2E suite proves the interaction pipeline with **real browser input**: boot + 500 stars, raycast → tooltip, double-click → planet view → trajectory → reset, the full add/delete/undo/localStorage loop, and toast remaining-window hydration.

CI also enforces the Lighthouse accessibility/SEO scores (currently **100/100 on both routes**) via `scripts/lighthouse-gate.mjs`; the gate fails the build on any regression.

## The Circle extraction: shared UI primitives and filter engine

The interactive chrome for FinBench and Delegate is built from UI primitives and a table-filtering engine extracted from **Circle**, our internal accounting-agent product (a frozen reference copy lives in `circle-master/`, excluded from `tsconfig`). Everything below is vendored under `components/ui/primitives/` and `components/data-table-filter/`, restyled onto this repo's token layer, and covered by the Playwright suite (51 specs across all three surfaces).

| Surface | Routes | What it is | Chrome |
|---------|--------|-----------|--------|
| **Galaxy** | `/`, `/galaxy`, `/system-map`, `/methodology` | 3D marketing experience (this README's original subject) | dark starfield |
| **FinBench** | `/finbench`, `/finbench/methodology`, `/finbench/tasks/[taskId]` | read-only AI accounting benchmark: scorecards, category matrix, filterable run records | dark |
| **Delegate** | `/delegate`, `/delegate/facilitator` | agent workshop tool + live facilitator console | monochrome light |

### Token layer

The primitives speak standard shadcn/ui color names (`background`, `popover`, `accent`, `ring`, …), mapped in `tailwind.config.js` to `--sc-*` CSS variables defined in `app/globals.css`: dark values at `:root` (Galaxy/FinBench chrome) and light values under `.delegate-light`, including a mode-specific radius:

```css
:root            { --sc-background: #030308; --sc-popover: #0a0a1a; --sc-radius: 0.5rem; … }
.delegate-light  { --sc-background: #ffffff; --sc-popover: #ffffff; --sc-radius: 0.375rem; … }
```

A surface opts into light mode by toggling the class on `<html>`; every primitive adapts automatically — no per-component theming.

```tsx
// app/delegate/page.tsx
useEffect(() => {
  document.documentElement.classList.add("delegate-light");
  return () => document.documentElement.classList.remove("delegate-light");
}, []);
```

### Primitives (`components/ui/primitives/`)

Radix-based shadcn/ui components, ported from the Circle extraction onto the token layer above:

| File | Notes |
|------|-------|
| `button.tsx` | cva variants (`default`/`outline`/`ghost`/…) + sizes; exports `buttonVariants` for non-button triggers |
| `input.tsx` | `forwardRef` — callers can autofocus a field after mount (React 18 drops refs on plain function components) |
| `popover.tsx` | portal + fixed positioning; passes through Radix props like `updatePositionStrategy` |
| `dialog.tsx` | overlay + content; `hideClose` prop for palettes that own their dismissal (⌘K, Esc) |
| `command.tsx` | cmdk wrapper; `CommandInput`/`CommandItem`/`CommandSeparator` are `forwardRef` |
| `table.tsx` | semantic table family used by FinBench run records and the facilitator grid |
| `checkbox.tsx`, `slider.tsx`, `tabs.tsx`, `calendar.tsx`, `separator.tsx`, `badge.tsx` | value pickers, numeric ranges, and chrome for the filter UI and forms |

```tsx
import { Button } from '@/components/ui/primitives/button';
import { DialogContent } from '@/components/ui/primitives/dialog';

<Button variant="outline" className="h-7 text-xs">Views</Button>
<DialogContent hideClose className="sm:max-w-xl">…</DialogContent>
```

### The data-table-filter engine (`components/data-table-filter/`)

A subject → operator → value filtering system for any tabular dataset, split into a headless core and a rendering layer:

- `core/types.ts` — the model: `FiltersState` is an array of `FilterModel`s (`{ columnId, type, operator, values }`) with a typed operator vocabulary per column kind (`text` → contains, `number` → is between, `option` → is/is not, …).
- `core/filters.ts` — `createColumnConfigHelper<T>()`, a fluent builder that infers accessor value types; `createColumns()` derives memoized option/facet getters and prefetch hooks from your data.
- `hooks/use-data-table-filters.tsx` — the headless hook: returns `{ columns, filters, actions, strategy }`; controlled (`filters` + `onFiltersChange`) or uncontrolled (`defaultFilters`). `strategy: 'server'` swaps client-derived options/counts for server-provided ones via the `options`/`faceted` inputs.
- `components/` — the `DataTableFilter` UI: a cmdk Filter popover (subject → operator → value), active-filter chips with ✕ removal, a Clear-all action, and a mobile layout. `lib/filter-fns.ts` holds the pure predicates; `lib/i18n.ts` + `locales/en.json` label the operators.

FinBench wires it to the run-records table (from `components/finbench/`):

```tsx
// 1. Describe the filterable columns (type-safe, inferred accessors).
const dtf = createColumnConfigHelper<FinbenchRunPublic>();
export const runFilterColumns = [
  dtf.option().id('result').accessor((run) => runResultKind(run))
    .displayName('Result').icon(CheckCircle2)
    .options([{ value: 'miss', label: 'numeric miss' }, …]).build(),
  dtf.number().id('groundedness_score').accessor((run) => run.groundedness_score)
    .displayName('Groundedness').icon(Gauge).build(),
  // … text, number, and option columns
] as const;

// 2. Drive the hook from URL state and render the UI.
const urlState = useRunFilterState();                       // nuqs ?filters=…
const { columns, filters, actions, strategy } = useDataTableFilters({
  strategy: 'client',
  data: runs,
  columnsConfig: runFilterColumns,
  faceted: runFacetedOptions(runs),                         // option → count map
  filters: urlState.filters,
  onFiltersChange: urlState.setFilters,                     // controlled
});

<DataTableFilter columns={columns} filters={filters} actions={actions} strategy={strategy} />

// 3. Apply the same state to your rows with the pure predicates.
const visible = applyRunFilters(runs, filters);
```

Filter state is URL-synced through nuqs under a single `?filters=` param (a JSON-serialized `FiltersState`, validated on parse — garbage degrades to the unfiltered view), so any filter combination is a shareable deep link, e.g. the one numeric miss in the published ASC 606 snapshot. Two conventions make this work with static prerendering: the nuqs-backed page is wrapped in `<Suspense>` (URL readers force a client bailout), and an empty filter list is stored as `null` so the param disappears entirely instead of rendering `?filters=`.

### Command palette (`components/ui/CommandPalette.tsx`)

A ⌘K / Ctrl+K palette mounted once in the root layout, so it works on every surface. It has three internal routes — navigation, every published FinBench task, and Delegate scenarios — driven by a `route` state (Esc or Backspace-on-empty walks back to root):

```tsx
<CommandItem onSelect={() => goScenario(scenario.id)} keywords={['workshop', 'delegate']}>
  <ClipboardList className="text-muted-foreground" /> {scenario.title}
</CommandItem>
```

Selecting a Delegate scenario is context-aware: from another page it deep-links `/delegate?scenario=s5`; from `/delegate` itself (already mounted, a query push would not re-render it) it dispatches the `delegate:select-scenario` CustomEvent that the page listens for. Both paths converge on one writer: `?scenario=` is a controlled nuqs param on the page (`parseAsStringEnum` over `s1`–`s6`, `clearOnDefault("s1")`, `<Suspense>` wrapper), the same writer the landing screen's scenario cards share — so the URL can never silently diverge from the selection (an earlier read-once parse left a stale param that a refresh re-applied), and an unknown value degrades to the default instead of breaking the page.

### Saved views (`components/finbench/saved-views.ts`)

Circle's named-views pattern adapted to FinBench: the current filter combination can be saved under a name and re-applied later. The store keeps the **engine-native `FiltersState`** (not a declarative copy), so applying a view replays through the identical nuqs pipeline as a hand-built filter or deep link. Persistence follows this repo's convention — plain `localStorage` (one namespace per benchmark track) with a `finbench:saved-views-changed` CustomEvent for same-tab updates and the `storage` event for cross-tab sync, instead of Circle's `zustand/persist`:

```ts
saveView({ name: 'Numeric misses', track, filters, description: describeFilters(filters) });
listSavedViews(track);   // sorted by name; corrupt rows are dropped, never thrown
deleteSavedView(view.id);
// Applying a view = feeding its engine-native filters back to the URL state:
onApply(view.filters);   // → nuqs setFilters → same ?filters= pipeline as a deep link
```

The `SavedViews` popover (bookmark trigger next to the filter bar) marks the active view — the one whose filters JSON-match the live state — with a check, and disables "Save current" until a filter exists.

The popover UI itself is shared: `components/ui/SavedViewsPopover.tsx` is generic over a small store contract (`list`/`save`/`update`/`remove`/`isActive`/`apply`/`describeCurrent`/`canSave` plus the store's write-event name, and an optional `shareUrl`) and a `mono` tone for Delegate's monochrome chrome. Views carry an emoji chip (a 14-icon palette Circle-style) and can be renamed or re-iconed after saving: the edit form reuses the save form prefilled and submits through `update()`, leaving the derived description untouched. When a store supplies `shareUrl`, each row gains a Share button that copies a link to the view without closing the popover. The facilitator console reuses it verbatim (`components/delegate/saved-views.ts`): a view snapshots the selected status facets plus sort key/direction — defaults stored as `null`, mirroring nuqs `clearOnDefault`, so a view replays into exactly the URL shape it was saved from — and sort keys are re-validated against the known set on apply, so a hand-edited store row degrades to the default sort instead of corrupting the URL. Unlike FinBench, the facilitator's default state is savable: a named full-room view is the escape hatch back after facet filtering. It is also the one surface with sharing: Share copies `origin + /delegate/facilitator?status=…&sort=…&dir=…&view=<name>` — the same deep-link shape, plus the view name for the receiver — and opening such a link shows an ephemeral "Opened shared view" toast, strips the `?view=` param immediately so a refresh never re-toasts, and leaves the state itself to the ordinary params.

### Surface usage

- **Galaxy** predates the extraction and intentionally does not consume the primitives: its overlays are bespoke (glass tooltip, planet panel, toast stack) and tightly coupled to the 3D scene. It benefits from the token layer and ships the ⌘K palette; its `components/ui/*` remain galaxy-specific.
- **FinBench** is the reference consumer of the full stack: engine + primitives for the run explorer, saved views on top, plus `Table` primitives for the category × model matrix. `RunsTable` is the canonical wiring example.
- **Delegate** uses the primitives in light mode (`.delegate-light`): the facilitator console renders its participant grid with `Table`, drives `?status=`/`?sort=`/`?dir=` through nuqs (comma-joined statuses, `clearOnDefault` so defaults never appear in the URL, `<Suspense>` wrapper), receives palette scenario picks via the `delegate:select-scenario` event, and offers saved views through the shared popover in monochrome tone — icon picker, rename, and shareable URLs included (an opened shared link toasts, then the toast and its `?view=` param self-strip). The participant screen keeps the same URL-state conventions: `?scenario=` is a controlled two-way param (`parseAsStringEnum`, `clearOnDefault("s1")`) that the palette event and the landing cards write through, and starting a run writes `?run=`/`?session=` (nullable parsers — absent must be null, never an empty string), so a refresh (or a shared run link) offers to reopen the workspace — declining strips both params, a submitted run restores read-only with its detection result and debrief note, and an unknown run id degrades to start-fresh guidance. All of it is backed by `GET /api/delegate/run/[runId]/state`, which rebuilds the transcript (each turn's tool calls included) from the append-only event log, and the facilitator grid closes the loop (the audit's end-to-end state-sharing goal): every row carries a Copy link action that puts that participant's `/delegate?run=…&session=…` resumable URL on the clipboard — opening it lands on the same consent-required restore offer, and a submitted participant's link restores read-only.

### Conventions for new surfaces

- Compose from `components/ui/primitives/*` and the engine before reaching for bespoke UI; style with token classes (`bg-popover`, `text-muted-foreground`) so both chrome modes work.
- Need a ref into a primitive (autofocus, scroll-into-view)? The primitive must be `forwardRef` — check before relying on it; React 18 silently drops refs on plain function components.
- Popover/dialog content is portaled and `position: fixed`: it re-anchors on scroll events, so open it from settled positions (or pass `updatePositionStrategy="always"` to re-anchor every frame) and drive it with the keyboard in e2e — pointer clicks on off-screen fixed content cannot be scrolled into view and hang.- Wrap any page reading URL state in `<Suspense>`; store client-only persistence in a `components/**` module with a change event, mirroring `saved-views.ts`.

## How It Works

- **Data**: `/api/companies` serves a curated dataset of ~193 real Fortune 500 enterprises (`lib/fortune500-data.ts`). Each company carries estimated AI-maturity scores (0–100 across five dimensions) plus a researched note on its public AI positioning, compiled from earnings-call commentary, product launches, and reported deployments (research estimates, not audited). Layout positions are pre-computed with the force simulation; 12 AI flagship companies are marked featured.
- **Rendering**: all 500 stars share one `InstancedMesh` (one draw call); per-instance color and scale are set from maturity. Only hovered/selected stars get individual meshes. Dust is a static `Points` cloud.
- **LOD**: labels and constellation lines fade in based on camera distance, so the galaxy stays uncluttered at overview and data-rich up close.
- **Persistence**: user stars live in `localStorage`; pending toasts in `sessionStorage` (survive refresh, die with the tab).

## Project Structure

```
app/            Next.js routes: page (landing), galaxy/, finbench/ (+ tasks/[taskId],
                methodology), delegate/ (+ facilitator), system-map/, /api/*
components/
  galaxy/       3D scene: GalaxyScene, StarField, StarLabels, ConstellationLines,
                TrajectoryPath, PlanetSystem, DustParticles, CameraRig, PostProcessing
  ui/           Galaxy overlays (LandingTitle, Tooltip, PlanetPanel, ToastStack, …)
                plus the shared extraction: primitives/ (shadcn-style kit),
                CommandPalette (⌘K), SavedViewsPopover, WebGLNotice, CompanyLogo
  finbench/     RunsTable (engine wiring), saved-views store, use-run-filters (nuqs)
  delegate/     Facilitator saved views (store + popover adapter)
  data-table-filter/  Circle filter engine: core/ (types, config builder),
                hooks/, components/ (popover UI), lib/ (filter fns, i18n)
lib/            constants, data generator, galaxy layout, user-company helpers,
                finbench snapshot loader
store/          Zustand store (mode, selection, toasts, user stars)
types/          Company / Trajectory / Maturity data model
e2e/            Playwright specs (76: galaxy, delegate agent effects, ?run= run
                resume, facilitator run links, saved views incl. share, finbench
                filters + saved views, ⌘K palette, facilitator grid, reduced
                motion, a11y)
```

## Reduced motion

The app honors the OS-level `prefers-reduced-motion` setting on three layers:

- **CSS**: a global kill switch in `globals.css` collapses keyframe and transition durations to ~0 (legend bubbles, trajectory breathe, scroll reveals, hover lifts).
- **Framer motion**: `MotionProvider` (mounted in `app/layout.tsx`) wraps the tree in `<MotionConfig reducedMotion="user">`, so every `motion.*` element skips transform animation while opacity fades remain.
- **WebGL / canvas**: react-three-fiber render loops gate themselves through the shared `usePrefersReducedMotion` hook. Idle decoration (galaxy rotation drift, star breathing and flicker, planet spin and moon orbits, ring pulses, auto-orbit, trajectory travel loop, system-map payload dots) is frozen; functional motion (star appear stagger, hover and selection feedback, camera fly-to on selection, zoom-driven fades) is preserved so the scenes stay fully operable as near-static diagrams. The Libraries.dev effects in Delegate (composer beam, thinking orb) unmount instead of animating; meaning is carried by text, borders, and disabled states.

The pass is proven end to end by `e2e/reduced-motion.spec.ts`, which emulates the setting in Playwright: the Delegate working state keeps its live-region status and disabled composer with no decorative canvas mounted, and the Galaxy starfield quaternion is sampled twice and shown frozen while the scene keeps rendering.

## Accessibility

Two automated gates run in CI and fail on regressions:

- **axe-core** (`e2e/a11y.spec.ts`, part of the Playwright suite) scans the WCAG 2.1 A/AA rule tags across all three surfaces — including interactive states, not just loaded routes: the galaxy planet panel and Add-Your-Company dialog, the FinBench Filter popover and deep-linked chip state, and the Delegate workspace while the agent is working plus the seeded facilitator console. Any violation fails the run; new exclusions must be added explicitly (with a justification) in the spec, never silently.
- **Lighthouse** (the `lighthouse` CI job) enforces a 100/100 accessibility + SEO score on `/` and `/galaxy` via `scripts/lighthouse-gate.mjs`.

## Roadmap

The following handoff-spec features are the natural next milestones:

- **Compare companies**: side-by-side maturity comparison.
- **Contact Primero**: the CTA in planet view links to the landing page's `#contact` section, which hosts a gated contact form (the address is only assembled on an actual submission, never rendered on the page).
- **Ambient generative audio** with a mute control.
- **Mobile strategy**: a light 3D mode or 2D fallback for touch devices.

## License

[MIT](LICENSE) © Primero. The design specification lives in `galaxy-handoff.md`.

## Logo attribution

The brand marks in `public/logos/` belong to their respective companies and are used nominatively to identify them. Per-file sources are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
