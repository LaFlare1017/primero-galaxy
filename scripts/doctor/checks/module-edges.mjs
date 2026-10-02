/**
 * Whether anything imports a PROGRAM, rather than a module it can share.
 *
 * The fake console used to live inside `neon-secrets.mjs`, and the reason it was
 * split out is written down in `neon-api.mjs`: a test server that lives inside
 * the program it tests can only be used by that program. Everything else that
 * wanted a console on localhost — the branch program's own checks, the store-job
 * rehearsal, the e2e spec that stands one up — had to import the PROVISIONING
 * PROGRAM to reach at it, which is a dependency backwards. It makes the
 * provisioning program impossible to delete without losing a fake, and it makes
 * the fake impossible to move somewhere better, because the next reader cannot
 * tell a deliberate cycle from the one that was just fixed.
 *
 * That is the whole rule here, and it is narrower than it sounds: it says
 * nothing about cycles, about layers, or about who may import whom among
 * modules. It says one thing — a file with an `isMain(import.meta.url)` guard
 * is a PROGRAM, and a program is an entry point, and nothing imports an entry
 * point. Everything else is a module, and modules may import each other freely.
 *
 * The payoff is that the fake console cannot quietly go back. Today four
 * consumers import it — `neon-secrets.mjs`, `neon-branch.mjs`, the rehearsal and
 * the spec — so inlining it would force three of them to import a program, and
 * each of those edges is a refusal rather than a judgement call. A structure
 * rule that only fires after somebody has already done the thing is a note; this
 * one refuses the first line of it.
 *
 * "PROGRAM" IS DEFINED BY THE GUARD, not by a list. A list is a second place a
 * program can be forgotten, and a module that grows an `isMain` guard without
 * being listed here would be imported freely while claiming to be an entry
 * point. Every program in this repository ends with that guard for the same
 * reason — so importing it to reach a function does not RUN it — which makes it
 * the one honest test of the thing this check is about.
 *
 * TEN EDGES ARE GRANDFATHERED, and each is named with the reason it is still
 * there rather than hidden in a comment. Four are between programs — a gate and
 * the gate that reuses its scan, the hook checker and the hook installer, and
 * the same shape in the Lighthouse and LinkedIn programs. The other six are the
 * doctor's OWN checks reaching into a program for the thing they are checking,
 * usually for its `proveItCan…` self-proof, which is why an earlier count of
 * this list said four and was wrong: the checks live two directories down and
 * a hand-grep of `scripts/*.mjs` does not see them.
 *
 * None of the ten is this check's business to fix: they ship and they work, and
 * a rule that went red on its first run would be a rule nobody keeps. The report
 * counts them and names them, so the debt is visible and cannot be mistaken for
 * the rule holding everywhere; and an entry whose edge has since disappeared is
 * called out by name, so the list shrinks when the debt is paid rather than
 * outliving the thing it was written down about.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { write } from '../fixture.mjs';

/**
 * Where programs and their consumers both live.
 *
 * `e2e` is here for the reason this check exists: a spec importing the console
 * is the edge that would have to appear first if the console moved back inside
 * a program, and a rule that only looked at `scripts/` would watch that happen
 * from the wrong side.
 */
const ROOTS = ['scripts', 'linkedin', 'e2e', 'delegate/scripts'];
const EXTS = ['.mjs', '.js', '.ts', '.tsx'];

/** What makes a module a program rather than a library. */
const PROGRAM_GUARD = /isMain\(\s*import\.meta\.url\s*\)/;

/**
 * Edges that exist today and are allowed to, each with why.
 *
 * Every one of these is a program importing another program, which is the shape
 * this check refuses. They are here because they ship and work, and a rule that
 * went red on its first run would be a rule nobody keeps — but they are named,
 * counted and dated in the report rather than exempted by silence.
 */
const GRANDFATHERED = [
  {
    from: 'scripts/hook-check.mjs',
    to: 'scripts/hooks-install.mjs',
    why: 'the checker asks the installer where hooks live and what a shadowed one looks like; one program, two jobs',
  },
  {
    from: 'scripts/lighthouse-run.mjs',
    to: 'scripts/lighthouse-gate.mjs',
    why: 'the runner audits and the gate reads the reports; splitting the reader out is the obvious fix and has not been paid yet',
  },
  {
    from: 'scripts/untracked-gate.mjs',
    to: 'scripts/gitignore-gate.mjs',
    why: 'the untracked gate reuses the gitignore gate’s scan rather than a second implementation of it',
  },
  {
    from: 'linkedin/render.mjs',
    to: 'linkedin/stats.mjs',
    why: 'render draws the facts stats collects, and the facts are the bigger half',
  },
  {
    from: 'scripts/doctor/checks/gitignore.mjs',
    to: 'scripts/gitignore-gate.mjs',
    why: "the check reuses the gate's scan and the gate's own proof that the scan can fail",
  },
  {
    from: 'scripts/doctor/checks/hooks.mjs',
    to: 'scripts/hook-check.mjs',
    why: 'the check asks the hook checker rather than answering its own question a second way',
  },
  {
    from: 'scripts/doctor/checks/hooks.mjs',
    to: 'scripts/hooks-install.mjs',
    why: 'where hooks live, and what counts as a shadowed one, is the installer’s to answer',
  },
  {
    from: 'scripts/doctor/checks/linkedin.mjs',
    to: 'linkedin/stats.mjs',
    why: "the era's length is a fact about this repository that stats already computes",
  },
  {
    from: 'scripts/doctor/checks/modes.mjs',
    to: 'scripts/hooks-install.mjs',
    why: 'the mode check asks the installer which files are hooks in the first place',
  },
  {
    from: 'scripts/doctor/checks/untracked.mjs',
    to: 'scripts/untracked-gate.mjs',
    why: "the check reuses the gate's audit and the gate's own proof that it can see",
  },
];

/** Comments out, strings left IN: the module specifier is the datum being read. */
function uncommented(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

/**
 * The relative specifiers a module imports.
 *
 * Anchored to the start of a line and forbidden from crossing a `;`, so a
 * string somewhere in the file that happens to read like an import is not
 * mistaken for one. Static `from` forms, a bare `import '…'`, and a dynamic
 * `import('…')` with a literal are all edges; a computed one is invisible to any
 * check that reads source, which is why the header says what this does not do.
 */
function importsIn(code) {
  const found = [];
  const forms = [
    /^[ \t]*import\b[^;]*?from\s*['"]([^'"]+)['"];?/gm,
    /^[ \t]*import\s*['"]([^'"]+)['"];?/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const form of forms) {
    for (const match of code.matchAll(form)) found.push(match[1]);
  }
  return found;
}

/** Every source file under the roots, minus the directories nothing reads. */
function sources(root) {
  const found = [];
  const skip = new Set(['node_modules', 'dist', 'test-results', 'snapshots', 'fixtures']);
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return; // a root this checkout does not have, which is not a failure
    }
    for (const entry of entries) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) walk(full);
      else if (EXTS.some((ext) => full.endsWith(ext))) found.push(full);
    }
  };
  for (const name of ROOTS) walk(join(root, name));
  return found;
}

/** A specifier as a repo-relative file, or null when it is not one we have. */
function resolveSpecifier(root, fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = resolvePath(dirname(fromFile), specifier);
  const candidates = [base, ...EXTS.map((ext) => base + ext), ...EXTS.map((ext) => join(base, `index${ext}`))];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return relative(root, candidate).split('\\').join('/');
    } catch {
      // not this one
    }
  }
  return null;
}

/** Whether a repo-relative file is a program: an entry point, by its own guard. */
function isProgram(root, file) {
  const full = join(root, file);
  if (!existsSync(full)) return false;
  return PROGRAM_GUARD.test(readFileSync(full, 'utf8'));
}

/**
 * Every edge in a repository that points at a program, as
 * `{ from, to, line }`, whether or not it is grandfathered.
 */
export function programImportsIn(root) {
  const edges = [];
  for (const file of sources(root)) {
    const rel = relative(root, file).split('\\').join('/');
    const code = uncommented(readFileSync(file, 'utf8'));
    for (const specifier of importsIn(code)) {
      const to = resolveSpecifier(root, file, specifier);
      if (to === null || to === rel) continue;
      if (!isProgram(root, to)) continue;
      // The line the specifier is on, so a finding can be pointed at. Comments
      // have already been blanked, so the first occurrence in the CODE is the
      // edge and not a mention of one.
      const at = code.indexOf(specifier);
      edges.push({ from: rel, to, line: at < 0 ? 1 : code.slice(0, at).split('\n').length });
    }
  }
  return edges;
}

export default {
  name: 'module edges',
  order: 46,
  commit: true,
  proof: [
    {
      level: 'pass',
      why: 'a program importing a module is the ordinary shape, and is what every healthy edge here looks like',
      setup: (root) => {
        write(root, 'scripts/neon-branch.mjs', "import { neon } from './neon-api.mjs';\n");
        write(root, 'scripts/neon-api.mjs', 'export const neon = () => {};\n');
      },
    },
    {
      level: 'pass',
      why: 'two programs importing one module is what makes the fake console impossible to inline, and is not a violation',
      setup: (root) => {
        write(root, 'scripts/neon-branch.mjs', "import { isMain } from './is-main.mjs';\nif (isMain(import.meta.url)) {}\n");
        write(root, 'scripts/neon-secrets.mjs', "import { isMain } from './is-main.mjs';\nif (isMain(import.meta.url)) {}\n");
        write(root, 'scripts/is-main.mjs', 'export const isMain = () => false;\n');
      },
    },
    {
      level: 'fail',
      why: 'a program importing another program — the dependency backwards that put the fake console inside the provisioning script',
      setup: (root) => {
        write(root, 'scripts/neon-branch.mjs', "import { startFakeNeon } from './neon-secrets.mjs';\n");
        write(root, 'scripts/neon-secrets.mjs', 'if (isMain(import.meta.url)) {}\nexport const startFakeNeon = () => {};\n');
      },
    },
    {
      level: 'fail',
      why: 'a spec importing a program, which is the edge that would appear first if the console went back inside one',
      setup: (root) => {
        write(root, 'e2e/thing.spec.ts', "import { startFakeNeon } from '../scripts/neon-secrets.mjs';\n");
        write(root, 'scripts/neon-secrets.mjs', 'if (isMain(import.meta.url)) {}\nexport const startFakeNeon = () => {};\n');
      },
    },
    {
      level: 'fail',
      why: 'a dynamic import with a literal specifier is an edge too, and a rule that only read static ones would miss it',
      setup: (root) => {
        write(root, 'scripts/store-job-rehearsal.mjs', "const f = await import('./neon-fake-console.mjs');\n");
        write(root, 'scripts/neon-fake-console.mjs', 'if (isMain(import.meta.url)) {}\nexport const startFakeNeon = () => {};\n');
      },
    },
    {
      level: 'pass',
      why: 'a module that merely looks like a program — a gate-shaped name, no isMain guard — is a module',
      setup: (root) => {
        write(root, 'scripts/untracked-gate.mjs', "import { scan } from './gitignore-gate.mjs';\n");
        write(root, 'scripts/gitignore-gate.mjs', 'export const scan = () => [];\n');
      },
    },
    {
      level: 'pass',
      why: 'prose describing the anti-pattern is not the anti-pattern — the console’s own header names it',
      setup: (root) => {
        write(
          root,
          'scripts/neon-fake-console.mjs',
          "/**\n * It was split out because a test server inside the program it tests can\n * only be used by that program: everything else had to import\n * `import { startFakeNeon } from './neon-secrets.mjs'` to reach at it.\n */\nexport const startFakeNeon = () => {};\n",
        );
      },
    },
    {
      level: 'pass',
      why: 'a file that does not exist cannot be imported, and a specifier with no extension still resolves to the module',
      setup: (root) => {
        write(root, 'scripts/neon-branch.mjs', "import { neon } from './neon-api';\n");
        write(root, 'scripts/neon-api.mjs', 'export const neon = () => {};\n');
      },
    },
    {
      level: 'warn',
      why: 'a checkout with none of these directories, where there is no edge to be wrong about',
      setup: () => {},
    },
  ],
  run(root) {
    const found = sources(root);
    if (found.length === 0) {
      return {
        level: 'warn',
        detail: 'none of the script directories are here — there was no import edge to read',
        hint: 'the programs under scripts/ are the entry points this check is about; without them the rule holds vacuously',
      };
    }

    const edges = programImportsIn(root);
    const allowed = new Set(GRANDFATHERED.map((edge) => `${edge.from} -> ${edge.to}`));
    const violations = edges.filter((edge) => !allowed.has(`${edge.from} -> ${edge.to}`));
    const live = edges.filter((edge) => allowed.has(`${edge.from} -> ${edge.to}`));
    // An allowance whose edge has gone is debt that was paid, and leaving it in
    // the list makes the next reader assume the shape is still there.
    const stale = GRANDFATHERED.filter((edge) => !live.some((found) => found.from === edge.from && found.to === edge.to));

    if (violations.length > 0) {
      return {
        level: 'fail',
        detail: `${violations.length} import${violations.length === 1 ? '' : 's'} of a program`,
        hint: [
          ...violations.map((edge) => `${edge.from}:${edge.line} imports ${edge.to}, which is a program (it has an isMain guard)`),
          'a program is an entry point — move what is shared into a module both sides can import',
          'scripts/neon-fake-console.mjs is shared by four callers BECAUSE it is a module; inlining it is what this refuses',
        ],
      };
    }
    // The grandfathered edges are COUNTED rather than listed: a hint prints under
    // a passing check too, so naming all ten there would turn a green line into
    // a wall, and the reasons for each are already written down next to it.
    return {
      detail:
        `no script imports a program — ${found.length} files read, the fake console stays a module` +
        (live.length === 0
          ? ''
          : `, and ${live.length} older edge${live.length === 1 ? '' : 's'} are grandfathered`),
      hint:
        stale.length === 0
          ? undefined
          : [
              'these allowances no longer describe an edge in this repository — delete them:',
              ...stale.map((edge) => `${edge.from} → ${edge.to} (${edge.why})`),
            ],
    };
  },
};