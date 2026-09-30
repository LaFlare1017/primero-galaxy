# LinkedIn assets — the declared-keyboard build

Everything needed to post the learning journey from the session that turned
every keyboard binding in this repo into a declared, checked artifact.

```
linkedin/
  article.md         the long-form LinkedIn ARTICLE: the sequel to the piece
                     already in galaxy/docs/LINKEDIN_ARTICLE.md, in the same
                     house format (stats up front, scar-to-lesson sections, an
                     honest admission, the playbook) — this is the one to lead with
  copy.md            the POSTS: main journey post, an engineering deep-dive, a
                     short one, the carousel caption, an optional AI-pairing
                     post, alt text for all ten slides, and posting notes
  carousel.html      the 10 slides at 1080x1080, in the product's own palette —
                     no numbers in it: every figure is a slot render.mjs fills
  render.mjs         exports the carousel (Playwright — already a dev dependency)
  stats.mjs          the one place the numbers come from: reads them out of the
                     repo, checks every asset against it, --write fills them in
  export/            generated, git-ignored: carousel.pdf, slide-*.png,
                     contact-sheet.html
```

**Order of play.** Publish `article.md` (an article gets a permanent URL, and it
matches the voice of the last one), then use `copy.md` §1 as a feed post that
links to it, with the carousel as the visual. The three short posts in §2–3 work
as follow-ups a few days apart — each one is a single lesson from the article
rather than a summary of it.

## The numbers are generated, not typed

```bash
node linkedin/stats.mjs --print      # what the repo says, and what is frozen
node linkedin/stats.mjs              # check: fail if any asset disagrees
node linkedin/stats.mjs --write      # rewrite the generated parts in place
```

Every figure quoted in these assets is read out of the thing it describes: the
commit count from git, the keyboards and lines from the declarations themselves,
the state counts from each spec's own pinned constant, the test count from
`playwright test --list`, the findings from the ledger in
`RETROSPECTIVE-KEYBOARDS.md`. Three mechanisms, one per kind of text:

- **Generated blocks** between `<!-- stats:begin … -->` markers — the lines with
  six numbers in them. Edit the prose inside a block and the check fails.
- **Inline claims**: a sentence located by a regex and rendered from the facts, so
  a number quoted in a paragraph (`Five surfaces, 1,410 lines…`) is rewritten by
  `--write` and verified by a plain run. A sentence that no longer matches is a
  failure, not a silent miss.
- **Slots** in `carousel.html`: the deck's source carries no numbers at all —
  `data-stat="tests"`, `data-count` for the `NN / NN` slide counters — and
  `render.mjs` fills them at export time, so a PDF cannot carry a stale number.

A number that cannot be derived (LinkedIn's own 210-character truncation, a
hand-measured post length, the previous article's frozen commit count) has to be
declared in `FROZEN` in `stats.mjs` **with a reason**. A plain run reports any
number in the prose that is neither derived nor declared, and exits non-zero — so
the list of things this script cannot check stays visible instead of growing.

## Render the assets

```bash
node linkedin/render.mjs             # 1080x1080 PDF + 2x PNGs + contact sheet
node linkedin/render.mjs --scale=1   # exactly 1080x1080 PNGs
```

Nothing to install: Playwright is a dev dependency because of the e2e suite. The
renderer also **fails loudly** if a slide's content overflows its frame, naming
the slide and the overflow in pixels — a clipped slide is the kind of thing you
otherwise discover after uploading.

Then:

- **Carousel** (the format that performs): upload `export/carousel.pdf` to
  LinkedIn as a **document**. It is ten 1080×1080 pages, one per slide.
- **Single image**: any `export/slide-NN-*.png` (2160×2160 at the default scale).
- **Review first**: open `export/contact-sheet.html` — all ten in one grid.

## The ten slides

| # | Slide | Carries |
|---|---|---|
| 1 | A keyboard is data | The hook, the three numbers |
| 2 | One key, written down four times | The problem: four copies agreeing by discipline |
| 3 | One Escape closed two layers | The bug that started the work |
| 4 | One declaration, read four ways | The move, and what a surface still supplies |
| 5 | Three questions one declaration can't ask itself | Coherence, agreement, coverage — and each one's blind spot |
| 6 | The DOM's timing is part of your interface | The capture-phase sequence, in three steps |
| 7 | The check that failed to fail | The mutation that passed, and what it exposed |
| 8 | Declaring a surface finds bugs | The four defects, terse |
| 9 | Five steps, in this order | The recipe: declare, read, enumerate, press, mutate |
| 10 | Write down what you believe… | The takeaway and the question back to the reader |

Editing a slide is editing one `<section class="slide" data-name="…">` in
`carousel.html`: the palette is the app's own tokens (`app/globals.css`), and a
slide's `data-name` becomes its filename. Keep the copy short — these are read on
a phone, and the renderer will tell you when you have overrun.

## What is honest in these assets

<!-- stats:begin readme.honest -->
- Every number is the repo's real one, and none of them is typed: `linkedin/stats.mjs`
  reads them out of the repo (git, the declaration modules, the specs,
  `playwright --list`) and fails if any asset disagrees with what it found — this
  line included. Right now: 15 commits in the era,
  5 declared keyboards, 1,410 lines of declaration,
  77 enumerated states, 133 e2e tests in 23 files,
  4 of 5 surfaces that found a defect by declaring their keyboard,
  28 ways the checkers' own spec breaks a synthetic manifest, and
  6 tests holding the checkers to that same standard.
<!-- stats:end -->
- The posts are written first-person and **do not name the employer or the
  products beyond a plain description** ("a 3D data galaxy, an
  accounting-AI benchmark, and a workshop simulator for AI delegation"). Add the
  employer if you want to.
- `copy.md` §5 (the AI-pairing post) is deliberately separate: it is a different
  claim aimed at a different audience, and it discloses tooling. Post it only if
  you want that on the record.
- The slides were checked for clipping programmatically and laid out at
  1080×1080; if you edit copy, re-run the renderer and it will refuse a slide
  that no longer fits.
