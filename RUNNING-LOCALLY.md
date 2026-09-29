# Running the app locally

Step by step, for the first time on a machine, and for the time the app stops
answering. Nothing here needs to be run more than once unless it says so.

If you only remember one line:

```bash
cd "/Users/leron.garriques/Library/CloudStorage/OneDrive-Slalom/Documents/AI Building/Experiments/Primero/Primero Insights/projects/galaxy" && npm run dev
```

…then open **http://localhost:3000/galaxy**. If the app is showing errors, use
`npm run dev:reset` instead of `npm run dev` ([step 5](#5-when-the-app-is-broken-start-over)).

---

## 1. Open a terminal and go to the project

Open **Terminal** (macOS: Spotlight → "Terminal"; Windows: PowerShell).

Copy this whole line, including the quotation marks, and press Enter:

```bash
cd "/Users/leron.garriques/Library/CloudStorage/OneDrive-Slalom/Documents/AI Building/Experiments/Primero/Primero Insights/projects/galaxy"
```

**The quotation marks are required.** The path contains spaces ("AI Building",
"Primero Insights"), and an unquoted `cd` stops at the first one and lands you in
the wrong directory. Every later command in this guide assumes you are already in
the project directory — if you open a new terminal tab, do this step again.

Two ways to avoid retyping it:

- **Drag the folder.** Type `cd ` (with the trailing space) in the terminal, then
  drag the `galaxy` folder from Finder onto the terminal window and press Enter.
- **Don't leave.** Keep one terminal tab open for the whole session; the dev
  server runs in it.

Confirm you are in the right place — it should print the path you just typed and
then the files:

```bash
pwd && ls
```

You should see `app/`, `components/`, `scripts/`, `package.json`, `README.md`.

> **This checkout lives in OneDrive**, which makes it slow to read: the first
> request for each route compiles it, and a cold compile here takes seconds, not
> milliseconds. A page that takes 5–10 seconds to appear the first time is
> normal. It is fast on the second visit.

## 2. Check Node and npm

```bash
node -v && npm -v
```

This machine currently has Node **v22.23.1** and npm **10.9.8**. That is fine:
the GitHub workflow declares Node 24, so `npm run doctor` will note that your
local Node is older than the one CI uses. It is a warning, not an error, and
nothing about running the app changes. Only install a different Node if
`node -v` fails outright.

## 3. Install the dependencies (once per clone)

```bash
npm install
```

Takes a few minutes the first time. Skip it if `node_modules/` is already there
— if it is, `npm install` just confirms everything is current.

## 4. Start the dev server

```bash
npm run dev
```

It prints something like:

```
   ▲ Next.js 14.2.35
   - Local:        http://localhost:3000
 ✓ Ready in 1.3s
```

**Leave that terminal running.** The server lives in it; closing the tab stops the
app. The first request for each route still compiles it, so the first load of a
page is the slow one.

Now open the app:

- **http://localhost:3000/galaxy** — the 3D galaxy itself. This is the direct experience.
- **http://localhost:3000/** — the landing page, which explains what the galaxy is before you go into it.

The app also runs in the **Preview** panel next to this chat, so you can see it
without opening a browser.

## 5. When the app is broken: start over

Symptom: every page shows **`500 Internal Server Error`**, or the terminal says
the port is in use, or the app looks stale and half-edited.

```bash
npm run dev:reset
```

This is the command for a dev server that has been up long enough to go stale. It
reclaims port 3000, clears the `.next/` cache, starts the server again and then
checks the app actually answers:

```
✓ stopped pid 56139  node .../next/dist/bin/next dev -p 3000 and the 1 process under it
✓ cleared .next/
✓ next dev is listening on :3000 (pid 56241)
✓ http://localhost:3000/ answers 200
    http://localhost:3000/galaxy
    log: /var/folders/.../T/primero-galaxy-dev.log
```

To see what it would do without letting it touch anything:

```bash
npm run dev:reset -- --dry-run
```

It only stops a server that belongs to **this** checkout. If port 3000 is held by
a dev server for a different project — and on this machine one usually is — it
refuses, names the process, and changes nothing, rather than killing somebody
else's work.

To watch what the server it started is doing:

```bash
tail -f "$TMPDIR/primero-galaxy-dev.log"
```

To put that log somewhere else instead:

```bash
npm run dev:reset -- --log ./dev.log
```

Either way the run takes a few seconds longer than it looks: before it stops or
deletes anything, it plants throwaway servers on ports the OS hands out and
proves it can still tell its own server from somebody else's, and a serving one
from a broken one. If one of those proofs fails it says so and changes nothing,
which is the point — you are about to let it `kill` and `rm -rf`.

**Do not run two dev servers against the same `.next/`.** That is the main cause
of the 500s this command exists to clear.

## 6. Stopping the server

Press **Ctrl-C** in the terminal running `npm run dev`. That is the same thing
`npm run dev:reset` does for you when it stops the old one.

To see whether anything is still holding the port:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

## 7. What is in the app

Three products live in this one Next.js app. All of them are on port 3000 while
the dev server is up.

| Route | What it is |
|---|---|
| `/` | Landing page — what the galaxy is, how to read it, how to navigate |
| `/galaxy` | The 3D galaxy: ~196 companies as stars, 12 industries |
| `/system-map` | The same data as a system map |
| `/methodology` | How maturity is scored |
| `/finbench` | FinBench — the AI accounting benchmark dashboard |
| `/finbench/methodology` | How FinBench scores |
| `/finbench/tasks/[taskId]` | One benchmark task, by id |
| `/delegate` | Delegate — the agent workshop you take part in |
| `/delegate/facilitator` | The facilitator's live console for a room |

## 8. Using the galaxy

The galaxy is a 3D scene, so the mouse drives it.

| Do this | What happens |
|---|---|
| Drag | Orbit the camera around the galaxy |
| Scroll | Dolly in and out |
| Hover a star | A tooltip with the company, industry and maturity score |
| Double-click a star | Fly to that company in planet view |
| <kbd>Esc</kbd> | Return to the galaxy from planet view |
| **Search** (or <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd>) | Type a company name and jump straight to its star; arrow keys to move, Enter to go |
| **Add Company** | Add your own company as a new star (name, industry, AI status). Saved in your browser, and it flies the camera to it |
| **Share** | Copy a link to the current view |
| **Reset view** | Put the camera back where it started |

A company you add lives in that browser's `localStorage` — it is not written to
the repo, and clearing site data removes it.

## 9. The other two products

**FinBench** (`/finbench`) is read-only: benchmark scorecards, a category × model
matrix, and a filterable table of every run. Filters live in the URL, so any view
you reach is a link you can share or bookmark.

**Delegate** (`/delegate`) is a workshop you take part in, and
`/delegate/facilitator` is the console the person running the room watches. The
delegate workspace under `delegate/` is a **separate npm project** with its own
`package.json`; it does not need installing to view the pages, and
`npm run reset:delegate` builds it and resets the cohort data.

## 10. Environment (optional)

The app runs without any configuration. One variable matters if you deploy or
care about link previews:

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

It is the absolute URL the app uses to build canonical and social-image links.
Copy `.env.local.example` to `.env.local` to set it on a fresh clone — it already
exists in this checkout. Without it, links fall back to `http://localhost:3000`.

## 11. Checking that things are healthy

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/galaxy   # want: 200
```

Then the repo's own checks, which answer questions a checkout can answer about
itself — dependencies, Node, env, the git gates, the recorded file modes, and
that every script under `scripts/` still runs when invoked:

```bash
npm run doctor        # everything
npm run doctor -- --fast   # just the commit-time subset
```

Other checks:

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run test:e2e      # Playwright, real browser input, on port 3100
```

`test:e2e` builds a **production** server on port **3100**, not 3000, and takes
several minutes. It is the suite, not a way to look at the app.

## 12. When something is wrong

| What you see | What it means | Do this |
|---|---|---|
| `500 Internal Server Error` on every page | Stale compile, or two dev servers shared one `.next/` | `npm run dev:reset` |
| `EADDRINUSE`, port 3000 in use | A server is already there | `npm run dev:reset` (it stops the old one first) |
| Page hangs, then appears after 10s | Cold compile; this checkout is in OneDrive | Wait; it is fast afterwards |
| `Refusing to reset: :3000 is held by a process that is not this checkout` | Another project's dev server has the port | Free it yourself, or use another port |
| Nothing at all on localhost:3000 | The server is not running | `npm run dev`, or `npm run dev:reset` |
| `npm: command not found` | Node is not installed / not on PATH | Install Node, reopen the terminal |
| Doctor warns about Node | Local Node is older than CI's Node 24 | Ignore it; it does not affect running the app |

## 13. Two things worth knowing before you commit

- **Never `git add -A`.** This repository has untracked material that does not
  belong in a commit (`galaxy/`, `design-variations/`, `enterprise-ai-galaxy/`,
  `PROJECT.md`, `RETROSPECTIVE.md`, `public/program-status.html`), and
  `npm run doctor` will tell you so. Stage the paths you changed, by name.
- **The commit hook is opt-in.** Run `npm run hooks:install` once per clone to
  have `npm run doctor -- --fast` run before each commit. Without it, commits
  skip the check — which is the only reason the doctor reports the hook as a
  warning rather than a fact.
