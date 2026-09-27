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

On CI (`retries: 2`, `trace: on-all-retries`), a flaky test **passes** the job — so the run is followed by `scripts/flaky-report.mjs`, which parses the JSON report and writes the flaky table (test, attempts, first-failure point) into the job summary and exposes a `flaky_count` output: the flake rate is a visible metric, never silently absorbed. Report and retry-attempt traces upload on every run, green or not. Locally the suite runs with `retries: 0` — a flake is a failure you see immediately, and the deterministic patterns in `e2e/cmdk.ts` exist precisely to keep it rare.

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

Filter state is URL-synced through nuqs under a single `?filters=` param (a JSON-serialized `FiltersState`, validated on parse — garbage degrades to the unfiltered view), so any filter combination is a shareable deep link, e.g. the one numeric miss in the published ASC 606 snapshot. The run table's column sort rides alongside as `?sort=`/`?dir=` (nuqs, `clearOnDefault` against task/asc — same shape as the facilitator console), so a sorted view is shareable too and a saved view replays into exactly the view it was saved from. Two conventions make this work with static prerendering: the nuqs-backed page is wrapped in `<Suspense>` (URL readers force a client bailout), and an empty filter list is stored as `null` so the param disappears entirely instead of rendering `?filters=`.

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
- **Delegate** uses the primitives in light mode (`.delegate-light`): the facilitator console renders its participant grid with `Table`, drives `?status=`/`?sort=`/`?dir=` through nuqs (comma-joined statuses, `clearOnDefault` so defaults never appear in the URL, `<Suspense>` wrapper), receives palette scenario picks via the `delegate:select-scenario` event, accepts `?scenario=` as a deep-linkable focus (an enum parser with no default: unknown values degrade to no focus) that dims the room down to one scenario and offers to open the participant view with it preselected, and offers saved views through the shared popover in monochrome tone — icon picker, rename, and shareable URLs included (an opened shared link toasts, then the toast and its `?view=` param self-strip). The participant screen keeps the same URL-state conventions: `?scenario=` is a controlled two-way param (`parseAsStringEnum`, `clearOnDefault("s1")`) that the palette event and the landing cards write through, and starting a run writes `?run=`/`?session=` (nullable parsers — absent must be null, never an empty string), so a refresh (or a shared run link) offers to reopen the workspace — with a best-effort preview of the run it points at (scenario name, elapsed clock frozen for a submitted run, message count, session owner — strictly informational; the accept click still verifies) — declining strips both params, a submitted run restores read-only with its detection result and debrief note, and an unknown run id degrades to start-fresh guidance. Arriving through a shared link is acknowledged once with a status toast on the landing screen (the facilitator `?view=` pattern — once per run per tab session, suppressed in the tab that started the run, so a participant refreshing their own session is never toasted). The workspace hands its own pointer over too: a Copy link button in the top bar (the saved-views Share pattern — a Copied flash, no toast) puts the resumable URL on the clipboard, and the same copy is offered at the consent gate where the params are the only copy of the pointer. All of it is backed by `GET /api/delegate/run/[runId]/state`, which rebuilds the transcript (each turn's tool calls included) from the append-only event log. Every surface that shows a run clock (the restore preview, the watch pane) reads elapsed seconds from one hook, `components/delegate/useElapsedClock.ts`, which ticks once a second while the run is live and freezes the instant `submittedAt` lands — so a submitted run can never show two different finish times depending on which screen you opened it from. The facilitator grid closes the loop (the audit's end-to-end state-sharing goal): every row carries Open and Copy link actions for that participant's `/delegate?run=…&session=…` resumable URL — Open launches it in a new tab and Copy puts it on the clipboard (both land on the same consent-required restore offer, and a submitted participant's link restores read-only) — and an eye toggle opens a watch pane that mirrors the run live from the state endpoint: status, an elapsed clock frozen at the submitted time, and the transcript as it grows, tool calls collapsed like the live chat. Once the run is in, the pane also carries the post-submit outcome the facilitator needs for the debrief — the detection verdict and the debrief note the participant is reading, never the score, which stays with the group debrief exactly as the participant panel holds it back. The verdict comes from the state endpoint's `verdict`, not its `detected`: `detected` answers `true` for a run whose scenario planted no defect to find (s5/s6 have no interception score), and a pane that trusted it would read "caught it" directly above a Detection cell saying "n/a". `verdict` is the grid's own rule, `null` when there is nothing to catch, so the pane renders no verdict line at all in that case — the honest silence the grid already models. Both fields ride the same 3s poll as the note, so a result block never sits on screen with a debrief note and no verdict. The watched run is `?watch=` state, so the mirror survives a refresh and can be shared; prev/next buttons sweep the currently visible participants (the active facets and sort — a working-facet sweep walks the working room), with wrap-around and a position indicator. The same sweep answers to `←`/`→` while the pane is open, and `Home`/`End` jump straight to the first and last visible participant, so walking a long room never needs the mouse: the listener is mounted only when there is somewhere to step, and it yields in every case where those keys already mean something else — a focused text field, a content-editable host, an open overlay (the ⌘K palette navigates its own results, the saved-views panel is open on top of the grid, and `End` in the palette search still belongs to the caret), or a modified press, since `⌘←` is the browser's back gesture. The one thing it does take over is page scrolling: while a run is being watched, `Home`/`End` mean first/last participant. `aria-keyshortcuts` advertises the full set only when stepping is possible, both controls carry their key in their tooltip, and the `N of M` indicator documents the jumps. That sweep is also the first adopter of the shared shortcut layer: `components/delegate/shortcuts.ts` holds the policy (`ownsArrowKeys`, `shortcutAllowed`) and `components/delegate/useKeyboardShortcuts.ts` the React wiring, so a surface binds keys in one call and inherits the same courtesy rules instead of re-deriving them. The grid itself carries the row-level twin of the same sweep, split in two so a long room can be scanned before anything is watched: `j`/`k` walk a cursor down the displayed rows — a ring on the row plus `aria-current`, because the walk never steals DOM focus from the grid's own controls, and a screen-reader-only `role="status"` region that says the row aloud, because neither of the other two speak: `aria-current` is read when you navigate to the row yourself, which a walk that holds focus still never does. The announcement is participant plus status — the two columns that decide pacing — derived from the live row rather than frozen at the moment of the move, so a run that submits while the cursor sits on it is announced as well, and a poll that changes nothing rewrites the same string and stays quiet. The elapsed clock is deliberately left out of it: it moves every second, and a live region that rewrites every second is one nobody can listen to. One walk means one voice — the open pane's arrow/Home/End transport announces the row it lands on through the same two functions, and the region is silent on arrival, because opening a shared `?watch=` link is not walking anywhere — and `Enter` or `w` opens the watch pane on the row the cursor stopped on, which is also what both keys do from a cold console (the first visible row) so neither has to be learned before it works. The cursor is the `?watch=` pointer whenever the pane is open, so the walk keeps sweeping the pane exactly as it did before, and closing the pane leaves the cursor where it was rather than losing the place. `w` is bound throughout; `Enter` yields whenever the keyboard is inside one of the grid's own controls, so a focused row button still means itself. The ends of the room are a chord rather than two more single keys, borrowed from GitHub and Gmail: `g` then `i` jumps to the first visible row, `g` then `n` to the last, wired through `components/delegate/useKeySequence.ts` — `g` alone is inert (a prefix, not a command), an unbound second key falls through so `g j` still walks, and an armed prefix lapses after a beat so a forgotten `g` cannot fire at the next letter. An inert prefix is also an invisible one, so the hook returns what is armed and the console shows it: a chip beside the shortcut legend naming the key it is waiting on and every key that completes it, in a `role="status"` live region because a screen reader has no other way to learn a chord is half-typed. The chip's list of completing keys is read off the same map the hook dispatches from, so it cannot advertise a key that is not bound, and it clears the moment the chord resolves, falls through, or lapses. The table advertises `j k Enter w` in `aria-keyshortcuts` and the toolbar names them all; that summary is the shortcut sheet's own trigger, because a mouse user has no `?` key, and `?` opens the sheet (`components/delegate/ShortcutLegend.tsx`). It is a Radix dialog, which is why it needed no suspension logic at all: `role="dialog"` is already a clause in the shared policy, so every shortcut behind the sheet goes inert the moment it opens and `Escape` closes it by the same dismissal the palette uses. Its job is to be true rather than decorative — every binding on this console is conditional, so each entry dims from the very gate expression that mounts the key (`canWalk`, `canCommit`, `canSweep`), and the dimming is restated in words ("not available right now") because a greyed row with no explanation reads as a rendering bug. Nothing watched means the transport is greyed out; a run already watched means `Enter`/`w` is. Key caps are separated by real whitespace rather than flex gaps, since a gap is invisible to the text content and the sheet has to read "g then i" to anything that copies it. Adding a focusable trigger also widened the Enter yield: focus is tracked on the page root instead of the table, so the console's own controls beside the grid — the facet chips, the sort buttons, the legend — get their Enter back rather than having it eaten by the commit binding. Bare letters are only as safe as the policy, so the spec types `j`, `k` and `w` into the palette search and asserts they land in the field while the cursor stays put.

### Conventions for new surfaces

- Compose from `components/ui/primitives/*` and the engine before reaching for bespoke UI; style with token classes (`bg-popover`, `text-muted-foreground`) so both chrome modes work.
- Need a ref into a primitive (autofocus, scroll-into-view)? The primitive must be `forwardRef` — check before relying on it; React 18 silently drops refs on plain function components.
- Popover/dialog content is portaled and `position: fixed`: it re-anchors on scroll events, so open it from settled positions (or pass `updatePositionStrategy="always"` to re-anchor every frame) and drive it with the keyboard in e2e — pointer clicks on off-screen fixed content cannot be scrolled into view and hang.
- cmdk lists (⌘K palette, FinBench filter popover): Enter activates whatever is highlighted at keypress time, and a controlled search must round-trip through React state before the list reflects it — so a keyboard-driven test drives the selection, not the search: `selectCmdkItem` in `e2e/cmdk.ts` arrows until the target row is selected (`[cmdk-item][data-selected="true"]`, in a retry loop) and presses Enter. Pointer clicks on items are always safe (items own their click handlers); the palette spec relies on this.
- Wrap any page reading URL state in `<Suspense>`; store client-only persistence in a `components/**` module with a change event, mirroring `saved-views.ts`.
- Global keyboard shortcuts go through `useKeyboardShortcuts` (`components/delegate/`), never a hand-rolled window listener: the shared policy keeps them out of text fields, content-editable hosts, and open overlays (a modal, or a popover like the saved-views panel — the panel is portaled and, in Radix 1.1.23, still a `role="dialog"`, so the policy matches both its role and its popper wrapper, and only while it is open), and refuses modified presses (`⌘←` is the browser back gesture). Bindings are keyed by unmodified `KeyboardEvent.key`; a shortcut that genuinely needs a chord composes its own handler on `ownsArrowKeys` instead of widening the policy. Pass `enabled` to mount nothing rather than a listener that would no-op. The policy guards the *sweep*, not the keystroke — a focused field still receives its characters, which is what makes a bare-letter binding (`j`/`k` on the grid) safe to have. A shortcut that needs two keys (the grid's `g i`/`g n` jumps) goes through `useKeySequence`, which layers the same policy on the whole chord, never consumes a key it does not own — so an unbound second key falls through to the binding that does — and lets an armed prefix lapse rather than firing at a letter typed much later. A chord is only honest if the console admits it is half-typed, so `useKeySequence` returns the armed prefix and the surface renders it (the console's chip is a live region, not just a drawing). A keyboard affordance that only moves something visual — a ring, a highlight, `aria-current` — needs a live region too, or it does not exist for half the room; keep the words to the facts that change what a person would do next, and leave ticking values (clocks, countdowns) out, since a region that rewrites every second is one nobody can listen to. Give each fact its own region rather than sharing one, because a status region re-reads its whole text on every change. Prefer a chord to spending a single key that already means something. A shortcut sheet must derive each entry's availability from the same gate expression that mounts its key, or it becomes a list of keys that teach people to press dead ones; a new modal surface needs nothing extra to be safe, because `role="dialog"` is already in the policy.

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
e2e/            Playwright specs (93: galaxy, delegate agent effects, ?run= run
                resume, facilitator run links, watch pane + scenario focus, saved
                views incl. share, finbench filters + saved views, ⌘K palette,
                facilitator grid, shortcut policy, reduced motion, a11y)
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
