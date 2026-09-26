# Delegate chat panel: URL-state audit

Question: should the participant screen (`/delegate`) put its state in the URL the way
the facilitator console does (`?status=/?sort=/?dir=/?view=` through nuqs)?

Short answer: **partially, yes — for two identifiers, not for the thread itself.**
The chat panel has exactly two pieces of state that benefit from living in the URL:
*which scenario is preselected* (already half-wired today) and *which run is open*
(a real resumability gap). The thread and everything downstream of the run are
server-side event-log data; the URL should carry the pointer, never the transcript.

---

## 1. State inventory on `/delegate` today

| State | Lives in | Lifetime | Survives refresh? |
|---|---|---|---|
| Scenario preselection (`s1`–`s6`) | `?scenario=` (read once) + `delegate:select-scenario` event | until selection changes | ❌ (read once on mount) |
| Session identity | `sessionId` React state only | component lifetime | ❌ |
| Run identity (`runId`) | React state only | component lifetime | ❌ |
| Agent thread | React state; **durable copy in the event log** (`prompt_sent`/`agent_response`, rebuilt by `readThreadFromEvents`) | event log is append-only on disk | transcript yes, UI no |
| Submitted flag / detection result | React state + `run.submittedAt` event | event log | ❌ (UI) |
| Viewer tab (GL/transactions/documents/reports) | React state | component lifetime | ❌ |
| Viewer filters (GL account/dates/entity/grouping) | React state | component lifetime | ❌ |
| Answer drafts (conclusion/checked/unsure) | React state | component lifetime | ❌ |
| s6 control state (reviewed drafts, authorize decision) | React state | run lifetime | ❌ |
| Elapsed timer | derived from `startedAt` | component lifetime | ❌ (resets to 0) |

The facilitator, by contrast, keeps all of its *view* state in nuqs params with
`clearOnDefault`, wraps the page in `<Suspense>`, maps defaults to `null` before
persisting/sharing, and re-validates hand-edited values on apply. The lesson from
that surface: **the URL is the snapshot/share layer, the server poll is the data
layer, and localStorage is the identity layer.** The participant screen already has
all three layers available — it just doesn't connect them.

## 2. The `?scenario=` gap (found during this audit)

The command palette deep link (`router.push('/delegate?scenario=s5')`) is the only
URL state on the page, and it is **read-once and uncontrolled**:

- The `useEffect` on mount reads `window.location.search` and copies it into
  `setScenarioId` — then the URL and the state can silently diverge (user picks a
  different scenario; URL still says `s5`).
- Worse: the in-place palette path (`delegate:select-scenario` CustomEvent,
  needed because a query-only push does not remount the page) **updates state but
  leaves the stale `?scenario=` param in the address bar**. A refresh after an
  in-place selection re-applies the old scenario from the URL — the exact class of
  bug the facilitator avoids by making nuqs the single source of truth.

**Recommendation (small, do first):** make `?scenario=` a controlled nuqs param
(`parseAsStringEnum` over the scenario ids, `clearOnDefault` against `s1`) and drive
both the deep link and the in-place selection through `setScenarioId`. The palette
keeps `router.push` for cross-page picks; for the same-page pick it calls
`setScenarioId` instead of dispatching the CustomEvent. One source, one direction,
no divergence. The existing e2e expectations (`command-palette.spec.ts`: URL shape
cross-page, in-place selection without navigation) both keep passing.

## 3. Opportunity 1 — `?run=`: resume a run from a URL (recommended)

**Problem today:** a mid-scenario refresh (accidental, or a facilitator restarting
the browser) drops the participant back to the landing screen with the run still
live on the server: the timer resets, the transcript vanishes from view, submitted
state disappears, and the event log keeps recording. There is no way back in except
starting a new run — which pollutes the facilitator row (the store accumulates) and
the scored artifact.

**Why the server side is already ready:**

- `POST /api/delegate/session` **already supports resume**: pass `sessionId` and a
  matching `participantLabel` and you get `{ sessionId, runId, manifest, resumed }`
  with a fresh run appended to the same session (ownership check included).
- The chat route rebuilds the runtime from the run record when the process
  restarted — resuming a run is already an anticipated server path.
- The event log is the durable truth for run identity (`runs[].sessionId`,
  `scenarioId`, `startedAt`, `submittedAt`).

**Design:** two controlled nuqs params on a `<Suspense>`-wrapped page:

- `?run=<runId>` — the open run. `runId` in the URL is a capability token (it is
  unguessable and all run APIs are keyed by it); that matches the existing
  security posture, where possession of the run id is what authorizes acting on
  the run.
- `?session=<sessionId>` (or localStorage, mirroring the current habit elsewhere
  in the repo — but for a *shareable* handoff, the URL param is the point).

On mount: if `?run=` is present and unsubmitted, restore by fetching that run's
state. If `?session=` is present without `?run=`, call
`POST /api/delegate/session { participantLabel, scenarioId, sessionId }` to resume.

**What it buys** (the facilitator-parity win): the participant's live screen
becomes *shareable the same way the facilitator's is* — a facilitator can pull a
stuck participant's URL, a participant can rejoin after a crash, a bookmark
survives the workshop. It also becomes the natural key for Opportunity 2.

**What it must NOT do:** ever resurrect a **submitted** run as editable
(`submittedAt` check on restore, mirroring the chat route's 409 guard — restore
read-only into the submitted view instead), and never auto-start a new run from a
stale param without explicit user action (a stale `?run=` after a scenario switch
must not silently append runs to the session; require the participant to confirm
resume or start fresh).

**Risks:** participant label changes on resume → the API already handles this
(ownership mismatch starts a fresh session, benign and visible on the grid).
Shared machines: the URL after logout is a re-entry capability — acceptable for the
in-person, single-facilitator v1, but worth a note in the run-of-show.

## 4. Opportunity 2 — thread restore: the transcript the UI forgets

The agent thread *is already durable* — `readThreadFromEvents(runId)` rebuilds the
full `user`/`assistant` alternating history from `prompt_sent`/`agent_response`
events, and the chat route uses exactly that for provider context on every turn.
The UI is the only consumer that doesn't read it back.

**Recommendation:** once `?run=` exists, add a small read endpoint
(`GET /api/delegate/run/[runId]/transcript` — events + submittedAt + startedAt) and
hydrate `messages` from it on restore. Effort is small because the scoring path
already proves event-log reconstruction works (process-restart history rebuild);
the only new surface is read-only JSON. Include `toolCalls` in the rebuild for
parity with live turns (the events carry tool/tool args/status).

This is the piece that most changes workshop behavior: "my browser refreshed"
stops losing visible evidence mid-scenario, and the facilitator can see a
participant's working thread at the debrief without touching scoring artifacts.

**Do not** make the thread itself URL state (no `?msg=N` scroll anchors, no
transcript-in-URL): it is append-only server data with no share/snapshot semantics
of its own — the run pointer covers every legitimate use.

## 5. Explicitly *not* URL state

- **Viewer tab, GL filters, answer drafts, s6 reviewed/authorize state** —
  per-participant working state with no share audience (a facilitator sharing a
  draft mid-scenario would leak answer content) and no refresh-recovery need once
  `?run=` restores the run. Drafts would also be lost anyway without server
  persistence, and putting them in the URL changes the scored-evidence story.
- **Elapsed timer** — derived from `run.startedAt` (event log); restore derives it,
  the URL shouldn't store it.
- **Anything participant-identifying beyond opaque ids** — the URL is a
  capability; keep labels out of it.

## 6. Constraints this audit confirms

- The event log API is unauthenticated by design (in-person v1); `?run=`-scoped
  reads change nothing about that posture — possession of the run id already
  authorizes chat/submit. Keep reads scoped by run/session id, never by
  participant label.
- `dataDir()` path joins in the existing API should sanitize id-shaped path
  segments before any new read endpoint ships (run ids are server-generated UUIDs
  today; validate the shape server-side anyway).
- Any page reading URL state needs the `<Suspense>` wrapper (facilitator
  precedent — nuqs/`useSearchParams` forces a CSR bailout on the static prerender).

## 7. Suggested sequencing

> **Status (all shipped):** 1. `?scenario=` two-way control — shipped (controlled nuqs
> enum param, palette + landing cards write through). 2. `?run=`/`?session=` restore —
> shipped (consent-required restore offer, read-only submitted restore, stale-id
> degradation). 3. Transcript endpoint + hydration — shipped
> (`GET /api/delegate/run/[runId]/state`, tool calls rebuilt per turn). 4. Facilitator
> grid run links — shipped (per-row Open and Copy link actions over the same URLs;
> participants share their own link from the workspace top bar).

1. **`?scenario=` two-way control** — smallest change, fixes a live divergence bug,
   no API work. (nuqs enum param + palette `setScenarioId`.)
2. **`?run=` + `?session=` restore** — the resumability win; session API already
   supports it; add submitted-run restore read-only.
3. **Transcript endpoint + UI hydration** — completes the refresh story; event log
   makes it cheap.
4. *(Optional)* facilitator grid row links `/delegate?run=…` so the console can
   hand a participant their own URL — the two surfaces then share state end to end,
   which is where this audit started.

## 8. Cross-surface review (post-shutdown audit): FinBench + Galaxy

Applying this audit's lens to the other two surfaces — what URL state they keep,
what is worth adding, and what stays out deliberately.

**Implemented — FinBench column sort is now URL state.** The run-records table's
sort (`task_id`/`model_version`/`latency_ms` + direction) was the last table state
in the repo that was still component-local `useState` — meaning a sorted view
could not be shared, and a saved view (which snapshots `?filters=`) replayed into
a different view than the one saved when the user had also sorted. It now rides
`?sort=`/`?dir=` through nuqs with the same conventions as the facilitator
console (`clearOnDefault` against task/asc, so a clean view shares param-free).
FinBench is now consistent: `?filters=` + `?sort=`/`?dir=` cover the run table,
`?track=` the track switch, and saved views snapshot `?filters=` which now
replays to the identical view including sort.

**Implemented — removed a dead URL surface.** The FinBench page's declared
`searchParams` type included `month` but nothing ever read it (the month lives
in the published snapshot and the run-of-show commands, not the URL). A
parameter that parses but does nothing is exactly the kind of silent divergence
this audit was written to kill; it is gone.

**Closed out — Galaxy selection stays out of the URL, deliberately.** The
galaxy's selected/hovered star could be a `?star=` deep link ("open the galaxy
directly on Anthropic"). Closing this out because the surface contradicts it:
the scene is one WebGL canvas with pre-computed force-sim positions; a URL-driven
selection would need the scene to boot, load the layout, then fly the camera —
a second async boot path with real mid-boot edge cases (star not yet mounted,
selection arriving before the scene is ready), all to save one search-and-click.
Selection state also has no share audience: the share button already ships the
whole experience (`navigator.share` with clipboard fallback), user-added stars
persist in localStorage, and toasts already survive reloads. If a deep link is
ever wanted, the honest path is `/galaxy?company=<slug>` at boot time — a
one-way deep link with no two-way sync — not bolting the selection store onto
nuqs.

**Closed out — Galaxy viewer/panel ephemera.** Hover, camera position, and open
panels follow the same reasoning: no share audience, no refresh-recovery need,
and the scene's boot flow is the wrong place to inject per-param logic.

**The rule that falls out** (matches §5): URL state earns its place when it has
a share audience or a refresh-recovery need AND a writer that can keep it in
sync. FinBench sort had both (a user sorting wants to paste the result; the
sort buttons write through). Galaxy selection has neither. The delegate surface
is the exemplar: every param it carries (`?scenario=`, `?run=`, `?session=`)
has an owner, a default that drops out, and an e2e proving the round-trip.
