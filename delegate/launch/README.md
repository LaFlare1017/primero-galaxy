# Delegate — launch video (15s)

A 1920×1080, fifteen-second launch piece for **Delegate only**: a finance
professional, one fake company, an AI agent that works the ledger, and the
planted defect that decides whether the human was paying attention.

```
delegate/launch/
  video.html        the deck: 5 beats over 15s, seekable (`window.__seek(t)`)
  capture.mjs       captures real UI stills + the run's own event log
  render.mjs        steps the timeline frame by frame, encodes the MP4
  fonts/            Geist + Geist Mono (SIL OFL 1.1, vendored from `geist`)
  export/           generated, git-ignored:
                      delegate-launch.mp4          the postable file
                      delegate-launch-poster.png   thumbnail, frame at 1.2s
                      preview.html                 self-contained, plays anywhere
                      stills/                      the captures (the deck's inputs)
```

## Two steps

```bash
bash /tmp/e2ego.sh                          # or any server: npm run start -- -p 3100
node delegate/launch/capture.mjs            # real runs → export/stills/ + facts.js
node delegate/launch/render.mjs             # 450 frames → export/delegate-launch.mp4
```

`capture.mjs` needs a **running product** and seeds a scratch store: it starts
three participants through the session API, starts a fourth scenario through the
UI (the flow that produces the resumable run link), types one real brief into the
composer, and screenshots the workspace and the facilitator grid. Then it reads
the run's event log back out of the state API.

`render.mjs` needs nothing but the deck and the captures. Open
`export/preview.html` to **watch** it (one file, fonts and stills inlined, with a
play button) — the MP4 is what you post.

Options: `--fps=60`, `--keep-frames` (leave the 450 PNGs for inspection).

## The beats

| # | Time | Carries |
|---|---|---|
| 1 | 0.0–2.6s | The wordmark, and the premise in one sentence |
| 2 | 2.6–6.2s | The brief, typed, beside the real workspace (`THE WORKSPACE`) |
| 3 | 6.2–9.6s | The agent working: the run's **own** event log, line by line |
| 4 | 9.6–12.6s | The catch: a real scenario-3 figure, in the one accent colour, over the facilitator grid |
| 5 | 12.6–15.0s | Takeaway, the four things that get scored, and the facts |

The whole piece is one accent: `#b91c1c`, the app's own destructive red, spent
once — on the planted defect. Everything else is the Delegate palette from
`app/globals.css` (`.delegate-light`): paper white, ink `#0a0a0a`, muted
`#71717a`, hairline `#e4e4e7`.

## What is real

- **The stills** are the product, captured from a live run — not a mock-up.
- **The event log** in beat 3 is the run's own records, read back from
  `/api/delegate/run/<id>/state`: the prompt that went in, every tool call with
  its real arguments (`tool.get_bank_feed entity=HLI-US month=2026-03`), and the
  agent's own reply. Nothing in that beat is invented for the video.
- **The tool names** come from the runtime's `availableTools`, the **company and
  scenario count** from `delegate/src/seed/profile.ts` and `delegate/scenarios/`.
- **The `$280K`** the piece puts its one accent on is scenario 3's `reclassAmount`, read
  out of `delegate/src/seed/defects/scenario3.ts` — the same habit as the LinkedIn
  assets: a number in the copy comes from the thing it describes, or it is not quoted.
- The **copy** is authored here (it is marketing, not a measurement). The end
  card has a `url.text` slot in `video.html` that is deliberately empty — set it
  to put a link on the last frame.

## The guards

A launch video fails silently: it encodes fine, it is the wrong length, a beat
never rendered, a headline ran off the frame, a paragraph is cut off. So the
render **refuses** rather than warns:

| Guard | Catches |
|---|---|
| stills / facts / fonts present | a missing capture, or a fallback font replacing the brand |
| composition at six times | anything bleeding off the 1920×1080 stage, or clipped by its own box (masks declared as data) |
| every beat appeared | a scene that never reached the frames — an enumeration that came back empty |
| distinct-frame floor | a timeline that never advanced: a still image with a duration |
| encode measured | a duration that drifted from the timeline, i.e. the wrong number of frames |

The guards were themselves checked the way the rest of this repo checks its
checks: a widened window was made to bleed, and the render died naming it
(`t=4.4s: brief-window bleeds off the stage`) instead of shipping a frame with
the copy hanging off the edge.

## Honest limits

- **Nobody has watched it frame by frame.** The preview panel's webview would not
  compose in the session that built this, so the composition is verified by
  geometry (6 sampled times × every visible element) rather than by eye. Open
  `export/preview.html` and you will see it in five seconds; that is the check
  this pipeline cannot do for you.
- 16:9 only. A 1080×1920 or square cut would mean re-laying the beats, not
  re-rendering them.
- The piece is silent by design (no voice-over, no music bed).
